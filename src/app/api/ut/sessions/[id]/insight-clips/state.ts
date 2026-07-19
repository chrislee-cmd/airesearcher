// Shared read-model for the insight-clips route (POST advance + GET read return
// the same shape). Raw storage keys are NEVER exposed — only a `has_clip`
// boolean; the bytes are reachable solely through the signed clips/[clipId]/play
// route (privacy, same contract as the recording download).
import type { SupabaseClient } from '@supabase/supabase-js';

export type InsightClipView = {
  id: string;
  start_ms: number;
  end_ms: number;
  theme: string | null;
  transcript_span: string | null;
  relevance: number | null;
  insight: Record<string, unknown> | null;
  has_clip: boolean;
};

export type InsightState = {
  status: string; // idle | indexing | searching | analyzing | reporting | done | error
  error: string | null;
  summary: Record<string, unknown> | null;
  clips: InsightClipView[];
};

export async function buildInsightState(
  admin: SupabaseClient,
  sessionId: string,
): Promise<InsightState> {
  const { data: session } = await admin
    .from('ut_sessions')
    .select('insight_status, insight_error, insight_summary')
    .eq('id', sessionId)
    .maybeSingle<{
      insight_status: string | null;
      insight_error: string | null;
      insight_summary: Record<string, unknown> | null;
    }>();

  const { data: clips } = await admin
    .from('ut_clips')
    .select('id, start_ms, end_ms, theme, transcript_span, relevance, insight, storage_key')
    .eq('session_id', sessionId)
    .order('start_ms', { ascending: true });

  return {
    status: session?.insight_status ?? 'idle',
    error: session?.insight_error ?? null,
    summary: session?.insight_summary ?? null,
    clips: (clips ?? []).map((c) => ({
      id: c.id,
      start_ms: c.start_ms,
      end_ms: c.end_ms,
      theme: c.theme,
      transcript_span: c.transcript_span,
      relevance: c.relevance,
      insight: c.insight,
      has_clip: Boolean(c.storage_key),
    })),
  };
}
