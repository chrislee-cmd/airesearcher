// GET /api/ut/sessions/[id] → { session }
//
// Session status + transcript readback for the widget to poll (recording →
// uploading → transcribing → done | error). Owner OR super-admin only (gate in
// loadUtSession). Raw storage keys are NOT returned — only booleans for
// whether each track exists; the signed-download route is the only way to reach
// the bytes.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { session } = gate;

  return NextResponse.json({
    session: {
      id: session.id,
      status: session.status,
      target_url: session.target_url,
      transcript: session.transcript,
      duration_ms: session.duration_ms,
      has_audio: Boolean(session.audio_storage_key),
      has_recording: Boolean(session.recording_storage_key),
      started_at: session.started_at,
      ended_at: session.ended_at,
      created_at: session.created_at,
    },
  });
}
