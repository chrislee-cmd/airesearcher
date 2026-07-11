import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '../llm/config';
import {
  DIARIZATION_SYSTEM,
  diarizationSchema,
  type DiarizationDecision,
} from './diarization-schema';
import type { ElevenLabsWord } from './elevenlabs';
import type { DeepgramResult } from './format';
import { genericSpeakerLabel, serializeLlmError } from './speaker-roles';

// Q&A 문맥 기반 LLM diarization.
//
// 일반 speaker-roles 패스는 "speaker_0 → 질문자 / speaker_1 → 응답자" 처럼
// **음향 화자별** 라벨링이라 speakers_count === 1 인 잡에서는 모든 turn 이
// 한 라벨로 묶임 — 통역사 1인 인터뷰 시나리오에서 누가 질문/답인지 잃어버림.
// 이 패스는 음향이 아니라 **내용 (Q&A 구조)** 기준으로 turn 별 host/guest 를
// 재할당. monologue 면 결과 폐기 → UI 는 기존 "Speaker N" fallback.
//
// 안전 fallback: API key 없음 / 너무 짧음 / LLM 에러 / monologue / low-confidence
// 모두 inferred=null 반환 → 호출자는 inferred_speakers 컬럼 NULL 로 두고 끝.

const MODEL = 'claude-sonnet-4-6';
const MIN_TURNS = 4;
const MAX_TURNS = 200;
const MIN_DURATION_SECONDS = 60;
const SAMPLE_TEXT_CAP = 240;
// ElevenLabs single-speaker 잡은 buildTurns() 가 1개 거대 turn 으로 묶기 때문에
// 호흡 단위로 다시 쪼개야 함. 단어 사이 gap 이 이 값 이상이면 새 turn 으로 분리.
const PAUSE_GAP_SECONDS = 1.0;

type Turn = { start: number; text: string };

/**
 * Deepgram 잡에서 turn 추출. `results.utterances` 가 이미 발화 단위로 잘려
 * 있어 그대로 활용. speakers_count=1 이라도 utterance 단위는 pause 기반이라
 * Q&A 교대 위치가 보존됨.
 */
function buildTurnsFromDeepgram(result: DeepgramResult): Turn[] {
  const utterances = result.results?.utterances ?? [];
  const turns: Turn[] = [];
  for (const u of utterances) {
    const text = (u.transcript ?? '').trim();
    if (!text) continue;
    turns.push({ start: u.start, text });
  }
  return turns;
}

/**
 * ElevenLabs Scribe 의 단일 speaker 잡은 모든 word 가 speaker_0 → buildTurns
 * 가 거대한 한 turn 으로 묶음. pause 길이 (단어 종료 → 다음 단어 시작 gap)
 * 가 PAUSE_GAP_SECONDS 이상이면 새 turn 으로 split — 호흡 단위로 분리해서
 * 통역사가 양쪽 발화 교대하는 자연스러운 boundary 를 살림.
 */
export function segmentByPauses(words: ElevenLabsWord[]): Turn[] {
  const turns: Turn[] = [];
  let current: { start: number; end: number; parts: string[] } | null = null;
  for (const w of words) {
    if (w.type === 'spacing' || typeof w.text !== 'string') continue;
    const start = typeof w.start === 'number' ? w.start : 0;
    const end = typeof w.end === 'number' ? w.end : start;
    const piece = w.type === 'audio_event' ? `[${w.text}]` : w.text;
    if (!current) {
      current = { start, end, parts: [piece] };
      continue;
    }
    const gap = start - current.end;
    if (gap >= PAUSE_GAP_SECONDS) {
      turns.push({ start: current.start, text: current.parts.join(' ').trim() });
      current = { start, end, parts: [piece] };
    } else {
      current.parts.push(piece);
      current.end = end;
    }
  }
  if (current) {
    turns.push({ start: current.start, text: current.parts.join(' ').trim() });
  }
  return turns.filter((t) => t.text.length > 0);
}

export type DiarizationAudit = {
  skipped: boolean;
  reason?: string;
  model?: string;
  confidence?: DiarizationDecision['confidence'];
  is_qa_structure?: boolean;
  reasoning?: string;
  turns?: number;
  truncated?: boolean;
  generated_at?: string;
};

export type DiarizationRoleEntry = {
  /** Turn 시작 timestamp (초). markdown body line 의 [HH:MM:SS] 와 매칭용. */
  start: number;
  role: 'host' | 'guest' | 'unknown';
};

export type InferredSpeakersPayload = {
  is_qa_structure: true;
  roles: DiarizationRoleEntry[];
  confidence: DiarizationDecision['confidence'];
  model: string;
  generated_at: string;
  reasoning: string;
  /** 입력 turn 수가 MAX_TURNS 초과해 일부만 분석했을 때 true. */
  truncated: boolean;
};

export type DiarizationResult = {
  /**
   * Q&A 검출 + 신뢰도 통과 시에만 set. null = monologue / 너무 짧음 /
   * API key 없음 / LLM 에러 / low confidence / 길이 불일치. 호출자는 NULL
   * 로 컬럼 두면 됨 — UI 가 자동으로 "Speaker N" 으로 fallback.
   */
  inferred: InferredSpeakersPayload | null;
  audit: DiarizationAudit;
};

function skipped(reason: string, extra?: Partial<DiarizationAudit>): DiarizationResult {
  return { inferred: null, audit: { skipped: true, reason, ...extra } };
}

/**
 * Deepgram 잡 (영어 / Deepgram async API) 용 entry. webhook/route.ts 에서
 * speakers_count === 1 분기 시 호출.
 */
export async function classifyQaDiarizationEn(
  result: DeepgramResult,
  filename: string,
  duration: number,
): Promise<DiarizationResult> {
  return classifyFromTurns(buildTurnsFromDeepgram(result), filename, duration, 'en');
}

/**
 * ElevenLabs Scribe 잡 (한국어 / multi 등 비영어) 용 entry. speaker-merge
 * 후 mergedWords 를 받음. single-speaker 인 경우라도 pause 기준으로 다시
 * 쪼개 분석.
 */
export async function classifyQaDiarization(
  words: ElevenLabsWord[],
  filename: string,
  duration: number,
): Promise<DiarizationResult> {
  return classifyFromTurns(segmentByPauses(words), filename, duration, 'ko');
}

async function classifyFromTurns(
  turns: Turn[],
  filename: string,
  duration: number,
  language: 'ko' | 'en',
): Promise<DiarizationResult> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return skipped('missing_api_key');
  if (duration < MIN_DURATION_SECONDS) return skipped('too_short');
  if (turns.length < MIN_TURNS) return skipped('too_few_turns');

  const truncated = turns.length > MAX_TURNS;
  const target = turns.slice(0, MAX_TURNS);

  const sampleLines = target
    .map((t, i) => `[${i + 1}] ${t.text.slice(0, SAMPLE_TEXT_CAP)}`)
    .join('\n');

  const prompt = `파일: ${filename}
음향 화자: 1명 (모든 발화가 같은 voice 로 인식됨)
주 언어: ${language === 'en' ? 'English' : 'Korean / mixed'}
총 turn: ${turns.length}${truncated ? ` (앞 ${MAX_TURNS}개만 표시)` : ''}
음성 길이: ${Math.round(duration)}s

[turn 들 — 한 줄 = 한 turn]
${sampleLines}

각 turn 에 host / guest / unknown 할당. roles 배열 길이 = ${target.length}.`;

  let decision: DiarizationDecision;
  try {
    const anthropic = createAnthropic({ apiKey });
    const llm = await generateObject({
      model: anthropic(MODEL),
      schema: diarizationSchema,
      system: DIARIZATION_SYSTEM,
      prompt,
      temperature: 0.1,
      maxOutputTokens: 4096,
      providerOptions: ZERO_RETENTION,
    });
    decision = llm.object;
  } catch (e) {
    const detail = serializeLlmError(e);
    console.warn(
      `[transcripts/diarization] LLM call failed (turns=${turns.length}, duration=${duration}s, lang=${language})`,
      detail,
    );
    return skipped(`llm_error: ${detail.slice(0, 500)}`);
  }

  const baseAudit: Partial<DiarizationAudit> = {
    model: MODEL,
    confidence: decision.confidence,
    is_qa_structure: decision.is_qa_structure,
    reasoning: decision.reasoning,
    turns: target.length,
    truncated,
    generated_at: new Date().toISOString(),
  };

  if (!decision.is_qa_structure) {
    return skipped('monologue_detected', baseAudit);
  }
  if (decision.roles.length !== target.length) {
    return skipped(
      `role_length_mismatch (${decision.roles.length} vs ${target.length})`,
      baseAudit,
    );
  }
  if (decision.confidence === 'low') {
    return skipped('low_confidence', baseAudit);
  }

  const roles: DiarizationRoleEntry[] = target.map((t, i) => ({
    start: t.start,
    role: decision.roles[i] ?? 'unknown',
  }));

  return {
    inferred: {
      is_qa_structure: true,
      roles,
      confidence: decision.confidence,
      model: MODEL,
      generated_at: baseAudit.generated_at ?? new Date().toISOString(),
      reasoning: decision.reasoning,
      truncated,
    },
    audit: {
      skipped: false,
      ...baseAudit,
    },
  };
}

/**
 * Render-time label substitution. `[HH:MM:SS] Speaker N:` body 라인을
 * inferred.roles 의 순서대로 host/guest 라벨로 치환.
 *
 * 매칭 규칙: body 의 N-번째 `Speaker M:` 토큰이 roles[N-1] 와 대응.
 * 라벨 부족 (roles.length < 라인 수) 시 남는 라인은 localized generic 라벨로
 * fallback — truncated / unknown 잡에서도 한국어 문서에 영어 "Speaker N" 이
 * 남지 않도록 `화자 N` 으로 치환 (en 은 "Speaker N" 그대로, 골격 동일).
 *
 * - language='ko' → 진행자 / 응답자 (미분류: 화자 N)
 * - language='en' → Host / Guest (미분류: Speaker N)
 *
 * speakerRoles (음향 화자 기준 LLM 분류) 와 함께 쓰일 때는 inferred 우선 —
 * preview/download 라우터가 이 함수 먼저 호출 후 applySpeakerLabels 는 skip.
 */
export function applyInferredSpeakerLabels(
  text: string,
  inferred: InferredSpeakersPayload | null | undefined,
  language: 'ko' | 'en' = 'ko',
): string {
  if (!text) return text;
  const labels: Record<DiarizationRoleEntry['role'], string> =
    language === 'en'
      ? { host: 'Host', guest: 'Guest', unknown: '' }
      : { host: '진행자', guest: '응답자', unknown: '' };

  const roles = inferred?.roles ?? [];
  let i = 0;
  return text.replace(/Speaker (\d+):/g, (match, raw: string) => {
    const entry = roles[i];
    i += 1;
    const label = entry ? labels[entry.role] : '';
    if (label) return `${label}:`;
    const oneIndexed = Number(raw);
    if (!Number.isFinite(oneIndexed) || oneIndexed < 1) return match;
    return genericSpeakerLabel(oneIndexed, language);
  });
}
