// AI UT 인사이트 — Gemini 영상이해 단일 호출 엔진 (card 585).
//
// 현행 TwelveLabs 4단(인덱싱→Marengo→ffmpeg→Pegasus→리포트)을 **한 번의 Gemini
// generateContent** 로 수렴한다: 세션 녹화(화면+음성)를 File API 로 올리고, 전사
// turn 을 참조 컨텍스트로 함께 넘겨, 모먼트 타임코드 + 모먼트별 인사이트 +
// 세션 리포트를 **동일 스키마**로 한 번에 받는다. 상태머신 배선은 insight-clips.ts
// 가 하고(클립 ffmpeg 컷은 그쪽 기존 로직 재사용), 이 파일은 순수하게 "영상 →
// 구조화 산출" 단일 호출만 담당한다.
//
// Why REST (not @ai-sdk/*): 녹화를 VIDEO 로 읽어야 하는데 repo AI SDK provider 는
// Anthropic(이미지 전용)이라 프레임 추출에 ffmpeg 가 필요하다. Gemini 는 영상을
// 네이티브로 샘플링하므로 새 의존성 없이 공개 Generative Language REST API 를
// 직접 호출한다(인앱 ut-vision/gemini.ts 와 동형, 스파이크 러너
// scripts/spikes/ut-video-eval.mjs 의 프롬프트·호출 패턴이 출발점).
//
// 스키마 SSOT = insight-llm.ts(복제 금지). 스파이크 스키마엔 모먼트별 insight
// 필드가 없었으나, spec §1 이 "단일 호출로 클립별 insight 까지"를 요구하므로
// 응답 스키마를 모먼트당 insight{summary,quote,friction,emotion,severity} 포함으로
// 확장했다(재발명 아님 — 필드는 ClipInsight 그대로).
//
// ⚠ 프라이버시: 녹화(로그인/결제 가능)를 Gemini 로 전송(영상분석기 622 와 동일
// 패턴). 반환 free-text 의 PII 마스킹은 호출부(insight-clips.ts)가 maskSensitiveDeep
// 로 persist 직전에 적용한다.

import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/env';
import { wrapUserInput, ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { TranscriptTurn } from '@/lib/transcripts/elevenlabs';
import type { ClipInsight, InsightSummary } from '@/lib/ut/insight-llm';
import type { UtSessionRow } from '@/lib/ut/auth';

const BASE = 'https://generativelanguage.googleapis.com';
// 인앱 검증된 최저비용 GA(ut-vision 도 동일 모델). env 로 A/B 오버라이드 가능.
const DEFAULT_MODEL = 'gemini-2.5-flash';

const FILE_ACTIVE_TIMEOUT_MS = 120_000; // 대용량 스크린레코딩 처리 대기
const FILE_POLL_INTERVAL_MS = 3_000;
// 단일 추론 데드라인(ms). 5~20분 영상 1패스 추론을 bound — 서버리스 300s 플랫폼
// 한계에 근접하지 못하게(insight-llm 의 per-call 타임아웃 관례와 동형).
const GENERATE_TIMEOUT_MS = 180_000;
const MAX_MOMENTS = 6;

// insight-clips.ts 가 소비하는 정규화된 모먼트(타임코드는 ms, transcript_span 은
// 배선부가 turn 경계 스냅으로 채운다). insight 는 Gemini 가 채운 클립 인사이트.
export type GeminiInsightMoment = {
  start_ms: number;
  end_ms: number;
  theme: string;
  query: string;
  relevance: number;
  insight: ClipInsight;
};

export type GeminiInsightResult = {
  moments: GeminiInsightMoment[];
  report: Omit<InsightSummary, 'generated_at'>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function langDirective(locale: string): string {
  return locale === 'en'
    ? 'Write all string values in English.'
    : 'Write all string values in Korean, using a polite, formal register.';
}

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function mimeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mkv') return 'video/x-matroska';
  return 'video/webm';
}

// ── 응답 스키마 (insight-llm momentsSchema + clipInsightSchema + reportSchema 참조,
//    OpenAPI subset — ut-vision/schema.ts geminiResponseSchema 와 동형 포맷) ──
function responseSchema(maxMoments: number) {
  const insightObj = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      quote: { type: 'string' },
      friction: { type: 'string' },
      emotion: { type: 'string' },
      severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['summary'],
  };
  return {
    type: 'object',
    properties: {
      moments: {
        type: 'array',
        maxItems: maxMoments,
        items: {
          type: 'object',
          properties: {
            start_sec: { type: 'number', description: 'moment start, seconds from video start' },
            end_sec: { type: 'number', description: 'moment end, seconds from video start' },
            theme: { type: 'string', description: 'short label e.g. "Confusion at checkout"' },
            query: { type: 'string', description: 'one-sentence description of the screen/audio' },
            relevance: { type: 'number', description: '0..1 insight value' },
            insight: insightObj,
          },
          required: ['start_sec', 'end_sec', 'theme', 'query', 'relevance', 'insight'],
        },
      },
      report: {
        type: 'object',
        properties: {
          overview: { type: 'string' },
          key_themes: {
            type: 'array',
            items: {
              type: 'object',
              properties: { theme: { type: 'string' }, detail: { type: 'string' } },
              required: ['theme', 'detail'],
            },
          },
          top_frictions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' },
                moment_index: { type: 'integer', description: '1-based supporting moment, or omit' },
              },
              required: ['title', 'detail'],
            },
          },
          notable_quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                moment_index: { type: 'integer' },
              },
              required: ['quote'],
            },
          },
          task_outcome: { type: 'string' },
        },
        required: ['overview', 'key_themes', 'top_frictions', 'notable_quotes', 'task_outcome'],
      },
    },
    required: ['moments', 'report'],
  };
}

function buildPrompt(
  taskGoal: string | null,
  locale: string,
  maxMoments: number,
  turns: TranscriptTurn[],
): string {
  const goalLine = taskGoal ? `Task goal (analysis context): ${taskGoal}\n\n` : '';
  // 전사 turn 을 참조 컨텍스트로 제공(spec §1 입력: transcript_words) — 한국어
  // 인용 정확도·타임코드 정렬 보조. 영상+오디오가 1차 근거, 전사는 보조.
  const transcript =
    turns.length > 0
      ? `\n\nFor reference, the speech transcript (per turn, MM:SS):\n${wrapUserInput(
          turns
            .map((t) => `${mmss(t.start_ms)}-${mmss(t.end_ms)} S${t.speaker}: ${t.text}`)
            .join('\n'),
          'ut_transcript',
        )}`
      : '';

  return `You are a UX researcher analyzing a usability test (UT) session recording (screen + audio).
${goalLine}Using the video's visuals AND audio as the primary evidence, do BOTH of the following in one pass:

1) moments: pick up to ${maxMoments} moments richest in insight (confusion/hesitation, errors or getting stuck, key task steps, strong emotional reactions, important utterances). For each moment give start_sec/end_sec (seconds from the start of the video, referring to the real timeline), a short theme label, a one-sentence description (query), relevance 0..1, and an insight object: {summary (2-3 sentences on what happened), quote (a key verbatim quote, empty string if none), friction (the difficulty, empty string if none), emotion (empty string if none), severity (low|medium|high)}. Keep moments non-overlapping and in time order.

2) report: synthesize a session insight report — overview (3-5 sentences), key_themes, top_frictions (each may reference a supporting moment by moment_index, 1-based), notable_quotes (verbatim, with moment_index), and task_outcome (success vs drop-off against the task goal, with evidence).

Observed facts only. Never copy sensitive data such as card numbers, passwords, or security codes. ${langDirective(locale)}${ISOLATION_NOTICE}${transcript}`;
}

// ── Files API 리줌어블 업로드(ut-vision/gemini.ts 와 동형) ─────────────────
async function uploadFile(
  apiKey: string,
  bytes: Buffer,
  mimeType: string,
): Promise<{ name: string; uri: string; state: string }> {
  const startRes = await fetch(`${BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'ut-recording' } }),
  });
  if (!startRes.ok) throw new Error(`gemini_upload_start_${startRes.status}`);
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('gemini_no_upload_url');

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'content-length': String(bytes.length),
    },
    body: new Uint8Array(bytes),
  });
  if (!upRes.ok) throw new Error(`gemini_upload_finalize_${upRes.status}`);
  const body = (await upRes.json().catch(() => null)) as {
    file?: { name?: string; uri?: string; state?: string };
  } | null;
  const file = body?.file;
  if (!file?.name || !file?.uri) throw new Error('gemini_upload_no_file');
  return { name: file.name, uri: file.uri, state: file.state ?? 'PROCESSING' };
}

async function waitActive(apiKey: string, name: string): Promise<'ACTIVE' | 'FAILED' | 'TIMEOUT'> {
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/v1beta/${name}?key=${apiKey}`);
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { state?: string } | null;
      if (j?.state === 'ACTIVE') return 'ACTIVE';
      if (j?.state === 'FAILED') return 'FAILED';
    }
    await sleep(FILE_POLL_INTERVAL_MS);
  }
  return 'TIMEOUT';
}

async function deleteFile(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${apiKey}`, { method: 'DELETE' });
  } catch {
    // Best-effort; Files API auto-expires uploads after ~48h.
  }
}

// ── 파싱 helpers (Gemini raw → 정규화) ──────────────────────────────────────
type RawMoment = {
  start_sec?: number;
  end_sec?: number;
  theme?: string;
  query?: string;
  relevance?: number;
  insight?: Partial<ClipInsight>;
};
type RawReport = {
  overview?: string;
  key_themes?: Array<{ theme?: string; detail?: string }>;
  top_frictions?: Array<{ title?: string; detail?: string; moment_index?: number }>;
  notable_quotes?: Array<{ quote?: string; moment_index?: number }>;
  task_outcome?: string;
};

function toClipInsight(raw: Partial<ClipInsight> | undefined): ClipInsight {
  const sev = raw?.severity;
  return {
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    quote: typeof raw?.quote === 'string' ? raw.quote : '',
    friction: typeof raw?.friction === 'string' ? raw.friction : '',
    emotion: typeof raw?.emotion === 'string' ? raw.emotion : '',
    severity: sev === 'medium' || sev === 'high' ? sev : 'low',
    source: 'gemini',
  };
}

// report 의 moment_index(1-based, Gemini 자체 넘버링)를 clip_index 로 옮긴다.
// insight-clips 가 모먼트를 시간순 그대로 클립화하므로 1:1. 범위 밖이면 null.
function toClipIndex(momentIndex: number | undefined, count: number): number | null {
  if (typeof momentIndex !== 'number' || !Number.isInteger(momentIndex)) return null;
  if (momentIndex < 1 || momentIndex > count) return null;
  return momentIndex;
}

// ── 단일 호출 진입점 ────────────────────────────────────────────────────────
// 녹화를 다운로드 → Gemini 업로드 → generateContent 1회 → 모먼트/리포트 정규화.
// 실패는 throw(호출부가 insight_status='error' 로 마킹). File 은 finally 로 정리.
export async function generateGeminiInsight(
  admin: SupabaseClient,
  session: UtSessionRow,
  locale: string,
): Promise<GeminiInsightResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('missing_gemini_key');
  if (!session.recording_storage_key) throw new Error('missing_recording');

  const { data: file, error: dlErr } = await admin.storage
    .from('ut-recording')
    .download(session.recording_storage_key);
  if (dlErr || !file) throw new Error('recording_download_failed');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = mimeForKey(session.recording_storage_key);

  const turns = Array.isArray(session.transcript_words)
    ? (session.transcript_words as TranscriptTurn[])
    : [];
  const model = env.UT_INSIGHT_GEMINI_MODEL || DEFAULT_MODEL;

  const uploaded = await uploadFile(apiKey, bytes, mimeType);
  try {
    const state =
      uploaded.state === 'ACTIVE' ? 'ACTIVE' : await waitActive(apiKey, uploaded.name);
    if (state !== 'ACTIVE') throw new Error(`gemini_file_${state.toLowerCase()}`);

    const genRes = await fetch(`${BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { file_data: { mime_type: mimeType, file_uri: uploaded.uri } },
              { text: buildPrompt(session.task_goal, locale, MAX_MOMENTS, turns) },
            ],
          },
        ],
        // media_resolution: default — 게이트가 품질이고 스크린 텍스트 판독에 유리.
        // 인앱 ut-vision 도 default. 긴 세션 비용이 문제면 저해상으로 튜닝 가능.
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: responseSchema(MAX_MOMENTS),
        },
      }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
    if (!genRes.ok) {
      const detail = await genRes.text().catch(() => '');
      throw new Error(`gemini_generate_${genRes.status}: ${detail.slice(0, 160)}`);
    }
    const gen = (await genRes.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text =
      gen?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new Error('gemini_empty_candidate');

    let parsed: { moments?: RawMoment[]; report?: RawReport };
    try {
      parsed = JSON.parse(text) as { moments?: RawMoment[]; report?: RawReport };
    } catch {
      throw new Error('gemini_invalid_json');
    }

    const rawMoments = Array.isArray(parsed.moments) ? parsed.moments : [];
    const moments: GeminiInsightMoment[] = rawMoments
      .map((m) => {
        const startS = typeof m.start_sec === 'number' ? m.start_sec : 0;
        const endS = typeof m.end_sec === 'number' ? m.end_sec : 0;
        const start_ms = Math.max(0, Math.round(Math.min(startS, endS) * 1000));
        const end_ms = Math.round(Math.max(startS, endS) * 1000);
        return {
          start_ms,
          end_ms,
          theme: (m.theme ?? '').slice(0, 120),
          query: (m.query ?? '').slice(0, 240),
          relevance: typeof m.relevance === 'number' ? Math.max(0, Math.min(1, m.relevance)) : 0.5,
          insight: toClipInsight(m.insight),
        };
      })
      .filter((m) => m.end_ms > m.start_ms)
      .slice(0, MAX_MOMENTS);

    const r = parsed.report ?? {};
    const count = moments.length;
    const report: Omit<InsightSummary, 'generated_at'> = {
      overview: typeof r.overview === 'string' ? r.overview : '',
      key_themes: Array.isArray(r.key_themes)
        ? r.key_themes.map((k) => ({ theme: k.theme ?? '', detail: k.detail ?? '' }))
        : [],
      top_frictions: Array.isArray(r.top_frictions)
        ? r.top_frictions.map((f) => ({
            title: f.title ?? '',
            detail: f.detail ?? '',
            clip_index: toClipIndex(f.moment_index, count),
          }))
        : [],
      notable_quotes: Array.isArray(r.notable_quotes)
        ? r.notable_quotes.map((q) => ({
            quote: q.quote ?? '',
            clip_index: toClipIndex(q.moment_index, count),
          }))
        : [],
      task_outcome: typeof r.task_outcome === 'string' ? r.task_outcome : '',
    };

    return { moments, report };
  } finally {
    void deleteFile(apiKey, uploaded.name);
  }
}
