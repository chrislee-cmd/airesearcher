// POST /api/ut/sessions
//   local  (default): { target_url? }                       → { id }
//   remote          : { mode:'remote', target_url?, task_goal?, session_kind? }
//                     → { id, participant_token, participant_url, livekit_room }
//
// Creates one AI-UT session for the authenticated user. The row is written via
// the service role: ut_sessions RLS has NO self-insert policy, so the browser
// cannot create rows directly (spec §제약 — 클라 직접 insert 금지).
//
// local mode is the original single-device self-capture flow (613·614): status
// starts at 'recording', the browser mints signed upload URLs and calls
// finalize. Unchanged — no regression.
//
// remote mode is the participant model: we mint an unguessable participant_token
// (the token IS the authorization — the participant is NOT authenticated), a
// LiveKit room for the live monitor, and return a shareable participant_url.
// status starts at 'waiting' (no participant yet); it walks to 'live' when the
// participant joins (publisher-token route), then uploading → transcribing →
// done via the token-scoped public finalize route.
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { env } from '@/env';

export const runtime = 'nodejs';

const Body = z
  .object({
    target_url: z.string().url().max(2000).optional(),
    mode: z.enum(['local', 'remote']).optional(),
    task_goal: z.string().trim().max(2000).optional(),
    session_kind: z.enum(['moderated', 'unmoderated']).optional(),
  })
  .optional();

// URL-safe, unguessable share token — same construction as translate's
// share_token (crypto.randomBytes, 21 chars) so the participant link can't be
// enumerated.
const TOKEN_LEN = 21;
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
function makeParticipantToken(): string {
  const bytes = randomBytes(TOKEN_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_LEN; i++) out += URL_SAFE[bytes[i] & 63];
  return out;
}

// Deployment base URL for the shareable participant link (prefer the
// deployment-specific URL so previews link to themselves).
function baseUrl(): string {
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limit = await rateLimit(user.id, 'ut-session-create', 20, '1 m');
  if (!limit.success) return rateLimitResponse(limit);

  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const target_url = parsed.data?.target_url ?? null;
  const mode = parsed.data?.mode ?? 'local';
  const task_goal = parsed.data?.task_goal?.trim() || null;
  const session_kind = parsed.data?.session_kind ?? 'moderated';

  // For remote sessions the live monitor needs LiveKit — fail early with a
  // clear signal so the caller can surface "원격 비활성" instead of a broken
  // half-created session (spec §제약 — LiveKit env 없으면 graceful).
  if (mode === 'remote' && (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL)) {
    return NextResponse.json({ error: 'remote_unavailable' }, { status: 503 });
  }

  // Best-effort org attribution (nullable column) — the active org at creation.
  const org = await getActiveOrg();

  const admin = createAdminClient();
  const insert = {
    user_id: user.id,
    org_id: org?.org_id || null,
    target_url,
    mode,
    task_goal,
    session_kind,
    // local starts 'recording' (unchanged); remote waits for the participant.
    status: mode === 'remote' ? 'waiting' : 'recording',
    participant_token: mode === 'remote' ? makeParticipantToken() : null,
    started_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from('ut_sessions')
    .insert(insert)
    .select('id, participant_token')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'create_failed' }, { status: 500 });
  }

  if (mode !== 'remote') {
    return NextResponse.json({ id: data.id });
  }

  // Persist the canonical room name (derivable from id) so the public RPC can
  // return it without recomputing. Room is 'ut:' || id, mirroring translate.
  const livekit_room = `ut:${data.id}`;
  await admin.from('ut_sessions').update({ livekit_room }).eq('id', data.id);

  return NextResponse.json({
    id: data.id,
    participant_token: data.participant_token,
    participant_url: `${baseUrl()}/ut-live/${data.participant_token}`,
    livekit_room,
  });
}
