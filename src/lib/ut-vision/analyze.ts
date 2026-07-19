// AI-UT vision post-processing orchestrator (card 622). Reads the finalized
// screen recording from the private ut-recording bucket, infers a QUANTITATIVE
// interaction-event stream with Gemini, persists the events, and aggregates
// deterministic behavior metrics. It NEVER touches the capture / upload /
// transcribe path — this runs after transcription is done, purely on the stored
// recording.
//
// Boundaries (spec §역할분리): quantitative only. No qualitative narration /
// clips / "why" — that is card 626 (TwelveLabs). Graceful throughout: any
// failure stamps meta.analysis.error and restores status 'done' so the session
// (which already has a valid transcript) is never broken by analysis.
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';
import { analyzeVideoWithGemini } from './gemini';
import { buildExtractionPrompt, modelResponseSchema, type UtEvent } from './schema';
import { maskNote } from './masking';
import { aggregateMetrics } from './metrics';

export type UtAnalyzeResult =
  | { ok: true; event_count: number }
  | { ok: false; error: string; status: number };

// A single row-shaped event ready to insert.
type EventRow = {
  session_id: string;
  t_ms: number;
  type: UtEvent['type'];
  confidence: number;
  meta: Record<string, unknown>;
};

function mimeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'mp4') return 'video/mp4';
  return 'video/webm';
}

// Stamp meta.analysis.{status,error,at} without clobbering existing meta (which
// may hold user_agent, transcription context, error detail). Mirrors the merge
// discipline in transcribe.ts.
async function stampAnalysis(
  admin: SupabaseClient,
  sessionId: string,
  baseMeta: Record<string, unknown>,
  patch: { status: string; error?: string },
  extra?: Record<string, unknown>,
): Promise<void> {
  await admin
    .from('ut_sessions')
    .update({
      meta: { ...baseMeta, analysis: { ...patch, at: new Date().toISOString() } },
      ...extra,
    })
    .eq('id', sessionId);
}

export async function analyzeUtSession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<UtAnalyzeResult> {
  const { data: row, error: rowErr } = await admin
    .from('ut_sessions')
    .select('id, recording_storage_key, duration_ms, task_goal, target_url, meta, status')
    .eq('id', sessionId)
    .single();
  if (rowErr || !row) return { ok: false, error: 'not_found', status: 404 };

  const baseMeta =
    row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {};

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    // No provider configured → skip gracefully, keep the session done.
    await stampAnalysis(admin, sessionId, baseMeta, { status: 'skipped', error: 'missing_gemini_key' }, { status: 'done' });
    return { ok: false, error: 'missing_gemini_key', status: 200 };
  }
  if (!row.recording_storage_key) {
    await stampAnalysis(admin, sessionId, baseMeta, { status: 'skipped', error: 'missing_recording' }, { status: 'done' });
    return { ok: false, error: 'missing_recording', status: 200 };
  }

  // Mark analyzing (transient — the transcript flow already reached 'done').
  await stampAnalysis(admin, sessionId, baseMeta, { status: 'analyzing' }, { status: 'analyzing' });

  // Pull the private recording down through the service role.
  const { data: file, error: dlErr } = await admin.storage
    .from('ut-recording')
    .download(row.recording_storage_key);
  if (dlErr || !file) {
    await stampAnalysis(admin, sessionId, baseMeta, { status: 'error', error: 'download_failed' }, { status: 'done' });
    return { ok: false, error: 'download_failed', status: 502 };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = mimeForKey(row.recording_storage_key);

  const prompt = buildExtractionPrompt({
    task_goal: row.task_goal,
    target_url: row.target_url,
    duration_ms: row.duration_ms,
  });

  const vision = await analyzeVideoWithGemini(apiKey, bytes, mimeType, prompt);
  if (!vision.ok) {
    await stampAnalysis(admin, sessionId, baseMeta, { status: 'error', error: vision.error }, { status: 'done' });
    return { ok: false, error: vision.error, status: vision.status };
  }

  const parsed = modelResponseSchema.safeParse(vision.json);
  if (!parsed.success) {
    await stampAnalysis(admin, sessionId, baseMeta, { status: 'error', error: 'schema_mismatch' }, { status: 'done' });
    return { ok: false, error: 'schema_mismatch', status: 502 };
  }

  // Clamp t_ms into the known session span, mask the one free-text field, and
  // normalize into typed events for both persistence and aggregation.
  const durationMs: number | null = row.duration_ms ?? null;
  const events: UtEvent[] = parsed.data.events.map((e) => {
    const t = durationMs ? Math.min(e.t_ms, durationMs) : e.t_ms;
    const note = maskNote(e.meta?.note);
    const meta = { ...e.meta };
    if (note === undefined) delete meta.note;
    else meta.note = note;
    return { t_ms: Math.round(t), type: e.type, confidence: e.confidence, meta };
  });

  // Replace any prior analysis for this session (idempotent re-run), then insert.
  await admin.from('ut_events').delete().eq('session_id', sessionId);
  if (events.length > 0) {
    const rows: EventRow[] = events.map((e) => ({
      session_id: sessionId,
      t_ms: e.t_ms,
      type: e.type,
      confidence: e.confidence,
      meta: e.meta,
    }));
    const { error: insErr } = await admin.from('ut_events').insert(rows);
    if (insErr) {
      await stampAnalysis(admin, sessionId, baseMeta, { status: 'error', error: 'insert_failed' }, { status: 'done' });
      return { ok: false, error: 'insert_failed', status: 500 };
    }
  }

  const metrics = aggregateMetrics(events, durationMs);
  await stampAnalysis(
    admin,
    sessionId,
    baseMeta,
    { status: 'done' },
    { status: 'done', behavior_metrics: metrics },
  );

  return { ok: true, event_count: events.length };
}
