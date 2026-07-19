// GET /api/ut/sessions/[id] → { session }
//
// Session status + transcript readback for the widget to poll (recording →
// uploading → transcribing → done | error). Owner OR super-admin only (gate in
// loadUtSession). Raw storage keys are NOT returned — only booleans for
// whether each track exists; the signed-download route is the only way to reach
// the bytes.
//
// Extended for the behavior-analytics layer (card 622): also returns the
// aggregated behavior_metrics, the inferred interaction events (ut_events), and
// a derived analysis_status so the widget can poll the vision post-processing
// the same way it polls the transcript. Events are QUANTITATIVE only.
import { NextResponse } from 'next/server';
import { loadUtSession } from '@/lib/ut/auth';

export const runtime = 'nodejs';

// analysis lifecycle surfaced from meta.analysis.status (written by the analyze
// pipeline). 'idle' = never run; 'analyzing' = in flight; 'done'/'error'/
// 'skipped' = terminal. behavior_metrics is non-null once a run completes.
function analysisStatus(meta: unknown): string {
  if (meta && typeof meta === 'object') {
    const a = (meta as { analysis?: { status?: string } }).analysis;
    if (a?.status) return a.status;
  }
  return 'idle';
}

function analysisError(meta: unknown): string | null {
  if (meta && typeof meta === 'object') {
    const a = (meta as { analysis?: { error?: string } }).analysis;
    if (a?.error) return a.error;
  }
  return null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gate = await loadUtSession(id);
  if ('error' in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin, session } = gate;

  // Events are read-through the service role (same as the row) so a prod RLS
  // drift can't blank the timeline; authorization already passed above.
  const { data: events } = await admin
    .from('ut_events')
    .select('t_ms, type, confidence, meta')
    .eq('session_id', id)
    .order('t_ms', { ascending: true });

  return NextResponse.json({
    session: {
      id: session.id,
      status: session.status,
      target_url: session.target_url,
      task_goal: session.task_goal,
      transcript: session.transcript,
      duration_ms: session.duration_ms,
      has_audio: Boolean(session.audio_storage_key),
      has_recording: Boolean(session.recording_storage_key),
      started_at: session.started_at,
      ended_at: session.ended_at,
      created_at: session.created_at,
      behavior_metrics: session.behavior_metrics ?? null,
      analysis_status: analysisStatus(session.meta),
      analysis_error: analysisError(session.meta),
      events: events ?? [],
    },
  });
}
