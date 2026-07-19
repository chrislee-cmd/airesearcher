// AI UT 인사이트 클립 (card 626, 방식 A) — 파이프라인 오케스트레이터.
//
// 상태 머신(ut_sessions.insight_status, 기존 status 와 독립):
//   null → indexing → searching → analyzing → reporting → done | error
//
// 각 advance() 호출은 **한 단계의 bounded work** 만 한다(서버리스 타임아웃 회피,
// video/jobs/poll 패턴과 동형): 클라가 반복 POST 로 파이프라인을 전진시킨다.
//   - indexing : 트웰브랩스 풀영상 1회 인덱싱 상태 폴링(getIndexedAsset).
//   - searching: 전사-LLM(+Marengo 보조) 순간 탐색 → turn 경계 스냅 → 녹화 1회
//                다운로드 → ffmpeg 클립 → ut-clips 업로드 → ut_clips insert.
//   - analyzing: 인사이트 미완 클립 1개를 Pegasus(구간 프롬프트)로 분석, 실패/
//                쿼터 시 구간 발화 텍스트-LLM 폴백. 남으면 계속, 없으면 reporting.
//   - reporting: 클립 인사이트 종합 → insight_summary.
//
// ⚠ 프라이버시: 녹화(로그인/결제 가능)를 트웰브랩스에 전송(영상분석기 기존 패턴).
// 클립은 private ut-clips 버킷, 인사이트/인용/리포트는 maskSensitiveDeep 후 저장.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createAsset,
  createIndexedAsset,
  getIndexedAsset,
  isAssetStillProcessing,
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
      if (isAssetStillProcessing(e)) return { status: 'indexing' };
      throw e;
    }
  }

  const indexed = await getIndexedAsset(s.tl_index_id, s.tl_indexed_asset_id);
  if (indexed.status === 'failed') {
    return { status: 'error', error: 'twelvelabs_indexing_failed' };
  }
  if (indexed.status !== 'ready') return { status: 'indexing' };

  await setStatus(admin, s.id, 'searching');
  return { status: 'searching' };
}

// ── searching → clip ─────────────────────────────────────────────────────
async function stepSearching(
  admin: SupabaseClient,
  s: UtSessionRow,
  locale: string,
): Promise<AdvanceResult> {
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
  // the LLM window. Failures (quota / unsupported) are swallowed — the LLM
  // turn-snapped window stands on its own.
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

  // Download the recording ONCE (streamed to a temp file to bound memory), cut
  // every clip from it, upload each to the private ut-clips bucket.
  const dir = await mkdtemp(join(tmpdir(), 'ut-rec-'));
  const recPath = join(dir, 'recording');
  try {
    if (!s.recording_storage_key) return { status: 'error', error: 'missing_recording' };
    const { data: signed } = await admin.storage
      .from('ut-recording')
      .createSignedUrl(s.recording_storage_key, 600);
    if (!signed) return { status: 'error', error: 'sign_failed' };
    await downloadToFile(signed.signedUrl, recPath);

    for (const seg of segments) {
      // Insert the row first so we own a clip id for the storage key.
      const { data: row } = await admin
        .from('ut_clips')
        .insert({
          session_id: s.id,
          user_id: s.user_id,
          start_ms: seg.start_ms,
          end_ms: seg.end_ms,
          theme: seg.theme,
          transcript_span: seg.transcript_span || null,
          relevance: seg.relevance,
        })
        .select('id')
        .single<{ id: string }>();
      if (!row) continue;

      // Cut + upload. A per-clip failure leaves storage_key null — the clip
      // still carries transcript_span and will get a text insight (graceful).
      try {
        const bytes = await clipSegment(recPath, seg.start_ms, seg.end_ms);
        const key = `${s.user_id}/${s.id}/${row.id}.mp4`;
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        const { error: upErr } = await admin.storage
          .from('ut-clips')
          .upload(key, ab, { contentType: 'video/mp4', upsert: true });
        if (!upErr) {
          await admin.from('ut_clips').update({ storage_key: key }).eq('id', row.id);
        }
      } catch {
        // keep going — clip row exists without media.
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  await setStatus(admin, s.id, 'analyzing');
  return { status: 'analyzing' };
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
        summary: clip.transcript_span?.slice(0, 300) || '분석을 생성하지 못했습니다.',
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

  const summary = await synthesizeReport(forReport, s.task_goal, locale, nowIso);
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
    : '한국어(존댓말)로 응답하세요.';
  const goal = taskGoal ? `과제 목표: ${taskGoal}\n` : '';
  const theme = clip.theme ? `이 순간의 테마: ${clip.theme}\n` : '';
  return `이 영상은 UX 사용성 테스트(UT) 녹화입니다. [${mmss(clip.start_ms)}~${mmss(clip.end_ms)}] 구간에 집중해서 분석하세요. ${goal}${theme}
그 구간에서 화면과 음성을 근거로 다음을 JSON 한 개로만 답하세요(다른 텍스트 없이):
{"summary": "그 순간 무슨 일이 있었는지 2~3문장", "quote": "핵심 발화 인용(없으면 빈 문자열)", "friction": "마찰/어려움(없으면 빈 문자열)", "emotion": "감정(없으면 빈 문자열)", "severity": "low|medium|high"}
관찰된 사실만. 카드번호·비밀번호 등 민감정보는 절대 옮기지 마세요. ${lang}`;
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
    summary: text.slice(0, 600) || '분석 결과가 비어 있습니다.',
    quote: '',
    friction: '',
    emotion: '',
    severity: 'low',
    source: 'pegasus',
  };
}

// Stream a signed-URL download to disk (avoid buffering a 500MB recording in
// memory). Throws if the response has no body or writes nothing.
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`recording_download_${res.status}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destPath));
  const info = await stat(destPath);
  if (info.size === 0) throw new Error('recording_empty');
}
