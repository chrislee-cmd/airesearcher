import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Landing visit capture — receives the first-party beacon fired on landing
// page mount and inserts one row into `landing_visits` (feeds analytics card
// #575). Insert runs through the service role because the table is otherwise
// locked to super-admin reads only (see the migration RLS).
//
// Privacy posture: we never store the raw IP — only the coarse country from
// the x-vercel-ip-country header. The visitor is identified solely by the
// first-party localStorage session_id the client sends.

// Bots inflate traffic counts and never convert, so we drop them before the
// insert. A lightweight substring match on the UA is deliberately conservative
// — it catches the common crawlers without a heavyweight UA-parser dependency.
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|w3c_validator|headless|lighthouse|preview|monitor|ping|curl|wget|python-requests|axios|node-fetch|go-http/i;

// Same session hitting the same path again within this window is treated as a
// duplicate beacon (double-mount, refresh spam) and ignored. Kept short so a
// genuine re-visit later still records.
const DEDUPE_WINDOW_MS = 30_000;

type Body = {
  session_id?: unknown;
  path?: unknown;
  referrer?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_term?: unknown;
  utm_content?: unknown;
};

// Trim + cap free-text fields so a malformed/oversized beacon can't bloat a row.
function str(value: unknown, max = 1024): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function hostFromReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent');

  // Bot skip — silently succeed so the client's fire-and-forget never retries.
  if (userAgent && BOT_UA.test(userAgent)) {
    return NextResponse.json({ ok: true, skipped: 'bot' });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const sessionId = str(body.session_id, 128);
  if (!sessionId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const path = str(body.path, 512);
  const referrer = str(body.referrer, 2048);
  const country = str(request.headers.get('x-vercel-ip-country'), 8);

  const admin = createAdminClient();

  // Lightweight duplicate suppression: skip if the same session already
  // recorded the same path within the dedupe window. Best-effort — a failed
  // lookup falls through to the insert rather than dropping the visit.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from('landing_visits')
    .select('id')
    .eq('session_id', sessionId)
    .eq('path', path)
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json({ ok: true, skipped: 'duplicate' });
  }

  // Fill user_id best-effort. The landing page redirects logged-in users to
  // /canvas, so this is almost always null — but if a session cookie is
  // present we attribute the visit.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const { error } = await admin.from('landing_visits').insert({
    session_id: sessionId,
    path,
    referrer,
    referrer_host: hostFromReferrer(referrer),
    utm_source: str(body.utm_source, 256),
    utm_medium: str(body.utm_medium, 256),
    utm_campaign: str(body.utm_campaign, 256),
    utm_term: str(body.utm_term, 256),
    utm_content: str(body.utm_content, 256),
    country,
    user_agent: str(userAgent, 512),
    user_id: userId,
  });

  if (error) {
    // Structured log so the Postgres reason (missing table / RLS) surfaces in
    // Vercel function logs rather than a bare client-side failure.
    console.error('[track/landing] insert failed', {
      session_id: sessionId,
      path,
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
