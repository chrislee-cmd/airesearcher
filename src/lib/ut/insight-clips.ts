// AI UT 인사이트 클립 (card 626, 방식 A) — 파이프라인 오케스트레이터.
//
// 상태 머신(ut_sessions.insight_status, 기존 status 와 독립):
//   null → indexing → searching → clipping → analyzing → reporting → done | error
//
// 각 advance() 호출은 **한 단계의 bounded work** 만 한다(서버리스 타임아웃 회피,
// video/jobs/poll 패턴과 동형): 클라가 반복 POST 로 파이프라인을 전진시킨다.
//   - indexing : 트웰브랩스 풀영상 1회 인덱싱 상태 폴링(getIndexedAsset).
//   - searching: 전사-LLM(+Marengo 보조) 순간 탐색 → turn 경계 스냅 → 클립 **계획**
//                (ut_clips row 만 insert, 미디어는 아직 안 자름). 세그먼트 존재 시
//                재-plan 금지(멱등) → clipping.
//   - clipping : **한 POST 당 클립 1개**만 서명 URL range-컷 → ut-clips 업로드 →
//                storage_key 기록. storage_key null·미실패 클립만 대상이라 504/중단
//                후 남은 클립부터 재개(멱등). 실패 클립은 cut_failed 로 마킹(무한
//                루프 방지) — analyzing 이 구간 텍스트로 폴백. 없으면 analyzing.
//   - analyzing: 인사이트 미완 클립 1개를 Pegasus(구간 프롬프트)로 분석, 실패/
//                쿼터 시 구간 발화 텍스트-LLM 폴백. 남으면 계속, 없으면 reporting.
//   - reporting: 클립 인사이트 종합 → insight_summary.
//
// per-call 타임아웃(twelvelabs·insight-llm·ffmpeg)으로 어떤 단일 외부호출도 300s
// 플랫폼 한계에 근접하지 못하게 막는다(card 638). 타임아웃/일시 오류는 스텝을
// 하드 error 로 떨구지 않고 in-place 재시도·폴백으로 graceful 처리.
//
// ⚠ 프라이버시: 녹화(로그인/결제 가능)를 트웰브랩스에 전송(영상분석기 기존 패턴).
// 클립은 private ut-clips 버킷, 인사이트/인용/리포트는 maskSensitiveDeep 후 저장.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createAsset,
  createIndexedAsset,
  getIndexedAsset,
  isAssetStillProcessing,
  isTimeoutError,
  getAnalyzeIndexId,
  searchIndex,
  analyzeVideo,
} from '@/lib/twelvelabs';
import type { TranscriptTurn } from '@/lib/transcripts/elevenlabs';
import { clipSegment } from '@/lib/ut/clip-video';
import { maskSensitiveDeep } from '@/lib/ut/mask-text';
import {
  planMoments,
  analyzeClipText,
  synthesizeReport,
  type ClipInsight,
  type ClipForReport,
} from '@/lib/ut/insight-llm';
import type { UtSessionRow } from '@/lib/ut/auth';

const MIN_CLIP_MS = 3000;
const MAX_CLIP_MS = 60000;
const MAX_CLIPS = 6;

export type InsightStatus =
  | 'idle'
  | 'indexing'
  | 'searching'
  | 'clipping'
  | 'analyzing'
  | 'reporting'
  | 'done'
  | 'error';

type AdvanceResult = { status: InsightStatus; error?: string };

// ── Kickoff: 풀영상 1회 인덱싱 시작 ────────────────────────────────────────
export async function startInsightPipeline(
  admin: SupabaseClient,
  session: UtSessionRow,
): Promise<AdvanceResult> {
  if (session.status !== 'done') {
    return { status: 'error', error: 'transcript_not_ready' };
  }
  if (!session.recording_storage_key) {
    return { status: 'error', error: 'missing_recording' };
  }

  let indexId: string;
  try {
    indexId = getAnalyzeIndexId();
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'missing_index' };
  }

  // Twelvelabs pulls the video from a signed URL (1h) — api/video/start 패턴.
  const { data: signed, error: signErr } = await admin.storage
    .from('ut-recording')
    .createSignedUrl(session.recording_storage_key, 3600);
  if (signErr || !signed) {
    return { status: 'error', error: signErr?.message ?? 'sign_failed' };
  }

  const filename = `ut-${session.id.slice(0, 8)}.mp4`;
  let assetId: string;
  try {
    assetId = await createAsset(signed.signedUrl, filename);
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : 'tl_asset_failed' };
  }

  let indexedAssetId: string | null = null;
  try {
    indexedAssetId = await createIndexedAsset(indexId, assetId);
  } catch (e) {
    if (!isAssetStillProcessing(e)) {
      return { status: 'error', error: e instanceof Error ? e.message : 'tl_index_failed' };
    }
    // Still transcoding — the 'indexing' poll retries createIndexedAsset.
  }

  await admin
    .from('ut_sessions')
    .update({
      tl_asset_id: assetId,
      tl_indexed_asset_id: indexedAssetId,
      tl_index_id: indexId,
      insight_status: 'indexing',
      insight_error: null,
    })
    .eq('id', session.id);

  return { status: 'indexing' };
}

// ── Advance one bounded step ───────────────────────────────────────────────
export async function advanceInsightPipeline(
  admin: SupabaseClient,
  sessionId: string,
  locale: string,
  nowIso: string,
): Promise<AdvanceResult> {
  const { data: s, error } = await admin
    .from('ut_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle<UtSessionRow>();
  if (error || !s) return { status: 'error', error: 'not_found' };

  const status = (s.insight_status ?? 'idle') as InsightStatus;
  try {
    switch (status) {
      case 'indexing':
        return await stepIndexing(admin, s);
      case 'searching':
        return await stepSearching(admin, s, locale);
      case 'clipping':
        return await stepClipping(admin, s);
      case 'analyzing':
        return await stepAnalyzing(admin, s, locale);
      case 'reporting':
        return await stepReporting(admin, s, locale, nowIso);
      case 'done':
      case 'error':
        return { status, error: s.insight_error ?? undefined };
      default:
        return { status: 'idle' };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insight_step_failed';
    await setError(admin, sessionId, msg);
    return { status: 'error', error: msg };
  }
}

async function setError(admin: SupabaseClient, sessionId: string, msg: string) {
  await admin
    .from('ut_sessions')
    .update({ insight_status: 'error', insight_error: msg })
    .eq('id', sessionId);
}

async function setStatus(admin: SupabaseClient, sessionId: string, status: InsightStatus) {
  await admin.from('ut_sessions').update({ insight_status: status }).eq('id', sessionId);
}

// ── indexing ───────────────────────────────────────────────────────────────
async function stepIndexing(admin: SupabaseClient, s: UtSessionRow): Promise<AdvanceResult> {
  if (!s.tl_index_id || !s.tl_asset_id) {
    return { status: 'error', error: 'missing_index_handles' };
  }
  // Deferred index (asset was still transcoding at kickoff) — retry.
  if (!s.tl_indexed_asset_id) {
    try {
      const id = await createIndexedAsset(s.tl_index_id, s.tl_asset_id);
      await admin.from('ut_sessions').update({ tl_indexed_asset_id: id }).eq('id', s.id);
      return { status: 'indexing' };
    } catch (e) {
      // Still transcoding OR a transient per-call timeout → keep polling in place
      // rather than hard-failing the whole run (the client re-POSTs).
      if (isAssetStillProcessing(e) || isTimeoutError(e)) return { status: 'indexing' };
      throw e;
    }
  }

  let indexed;
  try {
    indexed = await getIndexedAsset(s.tl_index_id, s.tl_indexed_asset_id);
  } catch (e) {
    if (isTimeoutError(e)) return { status: 'indexing' }; // transient — retry poll
    throw e;
  }
  if (indexed.status === 'failed') {
    return { status: 'error', error: 'twelvelabs_indexing_failed' };
  }
  if (indexed.status !== 'ready') return { status: 'indexing' };

  await setStatus(admin, s.id, 'searching');
  return { status: 'searching' };
}

// ── searching = plan clip segments (no media yet) ──────────────────────────
// Bounded to LLM planning + a few Marengo probes; the heavy recording download +
// ffmpeg cutting moves to `clipping` (one clip per POST) so this step can't run
// unbounded (card 638 §2). Idempotent: if clip rows already exist, planning ran —
// skip re-planning (no duplicate rows) and advance to clipping.
async function stepSearching(
  admin: SupabaseClient,
  s: UtSessionRow,
  locale: string,
): Promise<AdvanceResult> {
  const { data: existing } = await admin
    .from('ut_clips')
    .select('id')
    .eq('session_id', s.id)
    .limit(1);
  if (existing && existing.length > 0) {
    await setStatus(admin, s.id, 'clipping');
    return { status: 'clipping' };
  }

  const turns = Array.isArray(s.transcript_words) ? (s.transcript_words as TranscriptTurn[]) : [];

  // Plan moments from the transcript. Graceful: an LLM failure yields no moments
  // → we still produce a (thin) report so the researcher gets *something*.
  let moments: Array<{ start_ms: number; end_ms: number; theme: string; query: string; relevance: number }> = [];
  try {
    moments = await planMoments(turns, s.task_goal, locale, MAX_CLIPS);
  } catch {
    moments = [];
  }

  // Marengo refine (best-effort): boost relevance when a same-asset hit overlaps
  // the LLM window. Failures (quota / unsupported / timeout) are swallowed — the
  // LLM turn-snapped window stands on its own.
  if (moments.length > 0 && s.tl_index_id && s.tl_indexed_asset_id) {
    for (const m of moments) {
      try {
        const hits = await searchIndex(s.tl_index_id, m.query, {
          filterVideoId: s.tl_indexed_asset_id,
          pageLimit: 5,
        });
        const overlap = hits.find(
          (h) => h.end * 1000 >= m.start_ms && h.start * 1000 <= m.end_ms,
        );
        if (overlap) m.relevance = Math.max(m.relevance, overlap.score);
      } catch {
        break; // Marengo unavailable — stop probing, keep LLM windows.
      }
    }
  }

  const segments = moments
    .map((m) => snapToTurns(m, turns))
    .filter((seg): seg is Segment => seg !== null)
    .slice(0, MAX_CLIPS);

  if (segments.length === 0) {
    // No clippable moments — jump to reporting (report notes the thin evidence).
    await setStatus(admin, s.id, 'reporting');
    return { status: 'reporting' };
  }

  // Persist the plan as clip rows (storage_key null = media not cut yet). The
  // cutting happens in `clipping`, one row per POST.
  const rows = segments.map((seg) => ({
    session_id: s.id,
    user_id: s.user_id,
    start_ms: seg.start_ms,
    end_ms: seg.end_ms,
    theme: seg.theme,
    transcript_span: seg.transcript_span || null,
    relevance: seg.relevance,
  }));
  await admin.from('ut_clips').insert(rows);

  await setStatus(admin, s.id, 'clipping');
  return { status: 'clipping' };
}

// ── clipping (one clip per call) ───────────────────────────────────────────
// Cut + upload exactly ONE not-yet-cut clip, then stay in 'clipping' until none
// remain. Range-cuts straight from the signed recording URL (no full download
// per clip). Resumable: only clips with storage_key null and cut_failed = false
// are eligible, so a 504/interruption resumes from the remaining clips instead
// of restarting (card 638 §2). A per-clip cut failure marks cut_failed so the
// step can't loop forever — the clip keeps its transcript_span and picks up a
// text insight in analyzing (graceful, same as before).
async function stepClipping(admin: SupabaseClient, s: UtSessionRow): Promise<AdvanceResult> {
  const { data: clip } = await admin
    .from('ut_clips')
    .select('id, start_ms, end_ms')
    .eq('session_id', s.id)
    .is('storage_key', null)
    .eq('cut_failed', false)
    .order('start_ms', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; start_ms: number; end_ms: number }>();

  if (!clip) {
    // Every planned clip is cut (or marked failed) — move on to analysis.
    await setStatus(admin, s.id, 'analyzing');
    return { status: 'analyzing' };
  }

  if (!s.recording_storage_key) return { status: 'error', error: 'missing_recording' };
  const { data: signed } = await admin.storage
    .from('ut-recording')
    .createSignedUrl(s.recording_storage_key, 600);
  if (!signed) return { status: 'error', error: 'sign_failed' };

  try {
    const bytes = await clipSegment(signed.signedUrl, clip.start_ms, clip.end_ms);
    const key = `${s.user_id}/${s.id}/${clip.id}.mp4`;
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const { error: upErr } = await admin.storage
      .from('ut-clips')
      .upload(key, ab, { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new Error(upErr.message);
    await admin.from('ut_clips').update({ storage_key: key }).eq('id', clip.id);
  } catch {
    // Cut/upload failed for this clip — mark it so we don't re-attempt forever.
    // The clip still gets a text insight in analyzing (graceful degradation).
    await admin.from('ut_clips').update({ cut_failed: true }).eq('id', clip.id);
  }

  // More clips may remain — stay in 'clipping'; the client polls again.
  return { status: 'clipping' };
}

// ── analyzing (one clip per call) ──────────────────────────────────────────
async function stepAnalyzing(
  admin: SupabaseClient,
  s: UtSessionRow,
  locale: string,
): Promise<AdvanceResult> {
  const { data: clip } = await admin
    .from('ut_clips')
    .select('id, start_ms, end_ms, theme, transcript_span')
    .eq('session_id', s.id)
    .is('insight', null)
    .order('start_ms', { ascending: true })
    .limit(1)
    .maybeSingle<{
      id: string;
      start_ms: number;
      end_ms: number;
      theme: string | null;
      transcript_span: string | null;
    }>();

  if (!clip) {
    await setStatus(admin, s.id, 'reporting');
    return { status: 'reporting' };
  }

  let insight: ClipInsight | null = null;

  // Primary: Pegasus over the full indexed asset, prompt scoped to the span
  // (no re-upload / re-index — 방식 A). analyzeVideo returns free text; we ask
  // for a compact JSON and parse leniently.
  if (s.tl_asset_id) {
    try {
      const raw = await analyzeVideo(s.tl_asset_id, pegasusSpanPrompt(clip, s.task_goal, locale), 1200);
      insight = parsePegasusInsight(raw);
    } catch {
      insight = null; // fall through to text fallback
    }
  }

  // Fallback: text-LLM over the transcript span (Pegasus fail / quota / no asset).
  if (!insight) {
    try {
      insight = await analyzeClipText(clip.transcript_span ?? '', clip.theme ?? '', s.task_goal, locale);
    } catch {
      insight = {
        summary: clip.transcript_span?.slice(0, 300) || 'No analysis could be generated.',
        quote: '',
        friction: '',
        emotion: '',
        severity: 'low',
        source: 'text',
      };
    }
  }

  const masked = maskSensitiveDeep(insight);
  await admin.from('ut_clips').update({ insight: masked }).eq('id', clip.id);

  // More clips may remain — stay in 'analyzing'; the client polls again.
  return { status: 'analyzing' };
}

// ── reporting ──────────────────────────────────────────────────────────────
async function stepReporting(
  admin: SupabaseClient,
  s: UtSessionRow,
  locale: string,
  nowIso: string,
): Promise<AdvanceResult> {
  const { data: clips } = await admin
    .from('ut_clips')
    .select('start_ms, end_ms, theme, transcript_span, insight')
    .eq('session_id', s.id)
    .order('start_ms', { ascending: true });

  const forReport: ClipForReport[] = (clips ?? []).map((c, i) => ({
    index: i + 1,
    theme: c.theme,
    transcript_span: c.transcript_span,
    insight: (c.insight as ClipInsight | null) ?? null,
    start_ms: c.start_ms,
    end_ms: c.end_ms,
  }));

  let summary;
  try {
    summary = await synthesizeReport(forReport, s.task_goal, locale, nowIso);
  } catch (e) {
    // A transient LLM timeout shouldn't hard-fail (and restart) the whole run —
    // stay in 'reporting' so the client re-POSTs and retries synthesis in place.
    if (isTimeoutError(e)) return { status: 'reporting' };
    throw e;
  }
  const masked = maskSensitiveDeep(summary);
  await admin
    .from('ut_sessions')
    .update({ insight_summary: masked, insight_status: 'done', insight_error: null })
    .eq('id', s.id);

  return { status: 'done' };
}

// ── helpers ────────────────────────────────────────────────────────────────
type Segment = {
  start_ms: number;
  end_ms: number;
  theme: string;
  transcript_span: string;
  relevance: number;
};

// Snap a planned moment to the nearest enclosing turn boundaries and enforce the
// min/max clip-length guards so we never cut mid-utterance or produce a 200ms
// clip. transcript_span = the turn text inside the window.
function snapToTurns(
  m: { start_ms: number; end_ms: number; theme: string; relevance: number },
  turns: TranscriptTurn[],
): Segment | null {
  if (m.end_ms <= m.start_ms) return null;

  let start = m.start_ms;
  let end = m.end_ms;
  let span = '';

  if (turns.length > 0) {
    const inside = turns.filter((t) => t.end_ms > m.start_ms && t.start_ms < m.end_ms);
    if (inside.length > 0) {
      start = Math.min(...inside.map((t) => t.start_ms));
      end = Math.max(...inside.map((t) => t.end_ms));
      span = inside.map((t) => t.text).join(' ').trim();
    }
  }

  // Enforce a minimum length by padding symmetrically.
  if (end - start < MIN_CLIP_MS) {
    const pad = Math.ceil((MIN_CLIP_MS - (end - start)) / 2);
    start = Math.max(0, start - pad);
    end = end + pad;
  }
  // Enforce a maximum length by trimming the tail.
  if (end - start > MAX_CLIP_MS) end = start + MAX_CLIP_MS;

  return {
    start_ms: Math.round(start),
    end_ms: Math.round(end),
    theme: m.theme,
    transcript_span: span.slice(0, 2000),
    relevance: m.relevance,
  };
}

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function pegasusSpanPrompt(
  clip: { start_ms: number; end_ms: number; theme: string | null; transcript_span: string | null },
  taskGoal: string | null,
  locale: string,
): string {
  const lang = locale === 'en'
    ? 'Respond in English.'
    : 'Respond in Korean, using a polite, formal register.';
  const goal = taskGoal ? `Task goal: ${taskGoal}\n` : '';
  const theme = clip.theme ? `Moment theme: ${clip.theme}\n` : '';
  return `This is a UX usability test (UT) recording. Focus your analysis on the [${mmss(clip.start_ms)}-${mmss(clip.end_ms)}] segment. ${goal}${theme}
From that segment, using the screen and audio as evidence, answer with a SINGLE JSON object only (no other text):
{"summary": "2-3 sentences on what happened in that moment", "quote": "key verbatim quote (empty string if none)", "friction": "friction/difficulty (empty string if none)", "emotion": "emotion (empty string if none)", "severity": "low|medium|high"}
Observed facts only. Never copy sensitive data such as card numbers or passwords. ${lang}`;
}

// Pegasus streams prose even when asked for JSON — extract the first {...} block
// and validate the shape; otherwise treat the whole text as the summary.
function parsePegasusInsight(raw: string): ClipInsight {
  const text = raw.trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const o = JSON.parse(text.slice(first, last + 1)) as Partial<ClipInsight>;
      if (typeof o.summary === 'string' && o.summary.trim()) {
        const sev = o.severity;
        return {
          summary: o.summary,
          quote: typeof o.quote === 'string' ? o.quote : '',
          friction: typeof o.friction === 'string' ? o.friction : '',
          emotion: typeof o.emotion === 'string' ? o.emotion : '',
          severity: sev === 'medium' || sev === 'high' ? sev : 'low',
          source: 'pegasus',
        };
      }
    } catch {
      // fall through
    }
  }
  return {
    summary: text.slice(0, 600) || 'The analysis result was empty.',
    quote: '',
    friction: '',
    emotion: '',
    severity: 'low',
    source: 'pegasus',
  };
}
