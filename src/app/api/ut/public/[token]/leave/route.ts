// POST /api/ut/public/[token]/leave → { ok }
//
// pagehide beacon from the anon participant page. When the participant leaves
// abnormally (tab close / navigation / crash-adjacent unload) while the session
// is still open (waiting/live), there is no recording to preserve — uploads only
// start on an explicit stop() — so we mark the session error(participant_lost) +
// ended_at now, which releases the researcher's monitor from the permanent
// 'live' freeze this PR fixes. participant_token IS the authorization (mirrors
// the other public routes).
//
// Idempotent + regression-safe: only a still-open (waiting/live) session is
// touched, so a normal end (already transcribing/uploading/done) or a duplicate
// beacon is a no-op. meta is read-modify-write merged so existing fields (user
// agent, etc.) survive. Backstopped by /api/cron/ut-stale-live-sweep for the
// case where even pagehide never fires (hard crash / power loss).
import { NextResponse } from 'next/server';
import { resolveUtToken } from '@/lib/ut/public';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;

  // Only an open session is stale-able. The RPC-resolved gate doesn't carry
  // meta, so read it to merge (never clobber existing meta on error stamp).
  if (session.status !== 'waiting' && session.status !== 'live') {
    return NextResponse.json({ ok: true, skipped: session.status });
  }

  const { data: row } = await admin
    .from('ut_sessions')
    .select('meta')
    .eq('id', session.id)
    .single();
  const meta = {
    ...((row?.meta as Record<string, unknown> | null) ?? {}),
    error_reason: 'participant_lost',
  };

  const { error: updErr } = await admin
    .from('ut_sessions')
    .update({
      status: 'error',
      ended_at: new Date().toISOString(),
      meta,
    })
    .eq('id', session.id)
    .in('status', ['waiting', 'live']);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
