// POST /api/ut/public/[token]/finalize { duration_ms? } → { ok }
//
// Token-scoped counterpart of /api/ut/sessions/[id]/finalize for the anon
// participant. Called once the participant's uploads have flushed: stamps
// duration + ended_at, then runs the SAME transcribe pipeline (Scribe on the
// mic clip). task_goal rides along into the transcript meta as analysis context
// (transcribeUtSession). participant_token IS the authorization.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUtToken } from '@/lib/ut/public';
import { transcribeUtSession } from '@/lib/ut/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z
  .object({
    duration_ms: z.number().int().nonnegative().optional(),
  })
  .optional();

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;

  const { error: updErr } = await admin
    .from('ut_sessions')
    .update({
      duration_ms: parsed.data?.duration_ms ?? null,
      ended_at: new Date().toISOString(),
      status: 'transcribing',
    })
    .eq('id', session.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const result = await transcribeUtSession(admin, session.id);
  if (!result.ok) {
    // The row is already stamped 'error' by the helper; surface the reason.
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
