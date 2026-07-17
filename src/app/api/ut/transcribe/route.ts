// POST /api/ut/transcribe { session_id } → { ok, session_id }
//
// Mirror of api/qa/transcribe, but on fully separate data: ut-audio bucket →
// ut_sessions.transcript. A standalone retry entry point (finalize already
// triggers transcription inline); safe to re-fire. Owner or super-admin only.
// Rate-limited per user because it triggers a paid ElevenLabs Scribe call.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadUtSession } from '@/lib/ut/auth';
import { transcribeUtSession } from '@/lib/ut/transcribe';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  session_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { session_id } = parsed.data;

  const gate = await loadUtSession(session_id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const limit = await rateLimit(gate.user.id, 'ut-transcribe', 10, '1 m');
  if (!limit.success) return rateLimitResponse(limit);

  const result = await transcribeUtSession(gate.admin, session_id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, session_id });
}
