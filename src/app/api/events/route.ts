import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  LIMITS,
} from '@/lib/rate-limit';

// user_activity ingestion — the server mirror of client `track()` events
// (PR: user-activity-events-ingestion; feeds the admin timeline #611).
//
// track() dual-writes: Mixpanel (unchanged) + a non-blocking beacon here.
// This route is the ONLY write path to public.user_activity — the table has
// no insert RLS policy, so writes go through the service role. The server
// fills user_id / ip / user_agent / created_at so the client can't forge
// identity; the client only supplies event_key + a sanitized props whitelist
// + path + session_id.
//
// Fire-and-forget on the client: any non-2xx here is silently dropped by the
// beacon, so telemetry loss never touches UX. We still return meaningful
// statuses for observability in Vercel function logs.

// The beacon only fires for authenticated sessions (track() runs post-login),
// but an event with no session is dropped rather than stored anonymously —
// user_activity.user_id is NOT NULL and the table is a per-user timeline.

type Body = {
  event_key?: unknown;
  props?: unknown;
  path?: unknown;
  session_id?: unknown;
};

// Trim + cap a free-text field so a malformed/oversized beacon can't bloat a
// row. Mirrors the helper in /api/track/landing.
function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// props sanitizer — a strict allowlist of primitive values, NOT the LLM
// prompt-injection wrapper (that's for text going into a model). Rationale:
//   * PII minimization — email/tokens/raw form input must never land here.
//     We accept only shallow scalar props (the shape track() call-sites emit:
//     feature keys, counts, flags, ids) and drop everything else.
//   * bounded size — cap key count, key length, and string length so a
//     hostile client can't bloat the jsonb column.
//   * `email` is dropped explicitly — it is joinable via user_id and storing
//     it would duplicate PII (spec constraint).
const MAX_PROP_KEYS = 32;
const MAX_KEY_LEN = 64;
const MAX_STR_LEN = 512;
const PII_DENYLIST = new Set([
  'email',
  'e_mail',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'secret',
  'phone',
  'ssn',
]);

function sanitizeProps(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_PROP_KEYS) break;
    const key = rawKey.trim().slice(0, MAX_KEY_LEN);
    if (!key) continue;
    if (PII_DENYLIST.has(key.toLowerCase())) continue;
    // Only shallow scalars — objects/arrays/functions are dropped so nested
    // free-text (which could carry PII) never lands.
    if (typeof rawVal === 'string') {
      const v = rawVal.slice(0, MAX_STR_LEN);
      out[key] = v;
      count += 1;
    } else if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      out[key] = rawVal;
      count += 1;
    } else if (typeof rawVal === 'boolean') {
      out[key] = rawVal;
      count += 1;
    }
    // null / undefined / object / array → dropped
  }
  return out;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eventKey = str(body.event_key, 128);
  if (!eventKey) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Session required — the client cannot supply user_id, we derive it from the
  // auth cookie. No session ⇒ nothing to attribute the event to.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Per-user write cap. `general` (100/min) comfortably covers real click
  // streams while bounding a runaway/hostile client. Fire-and-forget beacon,
  // so a 429 is just silently dropped — no user-visible throttling.
  const limit = await rateLimit(
    userId,
    'events',
    LIMITS.general.limit,
    LIMITS.general.window,
  );
  if (!limit.success) {
    return rateLimitResponse(limit);
  }

  const admin = createAdminClient();
  const { error } = await admin.from('user_activity').insert({
    user_id: userId,
    event_key: eventKey,
    props: sanitizeProps(body.props),
    path: str(body.path, 512),
    session_id: str(body.session_id, 128),
    ip: getClientIp(request),
    user_agent: str(request.headers.get('user-agent'), 512),
  });

  if (error) {
    // Structured log so the Postgres reason (missing table / RLS) surfaces in
    // Vercel function logs rather than a bare client-side failure.
    console.error('[api/events] insert failed', {
      event_key: eventKey,
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
