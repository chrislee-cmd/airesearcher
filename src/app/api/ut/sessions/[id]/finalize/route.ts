// POST /api/ut/sessions/[id]/finalize { duration_ms? } → { ok }
//
// Called once both uploads (mic-audio + screen recording) have flushed. Stamps
// duration_ms + ended_at, then triggers transcription synchronously (Scribe on
// a short mic clip, well inside the 60s budget). Owner only. Transcription is
// the SAME pipeline the standalone POST /api/ut/transcribe exposes for
// retries — both call transcribeUtSession, so status walks
// transcribing → done | error here too.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadUtSession } from '@/lib/ut/auth';
import { transcribeUtSession } from '@/lib/ut/transcribe';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z
  .object({
    duration_ms: z.number().int().nonnegative().optional(),
  })
  .optional();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { admin, session } = gate;

  const { error: updErr } = await admin
    .from('ut_sessions')
    .update({
      duration_ms: parsed.data?.duration_ms ?? session.duration_ms ?? null,
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
