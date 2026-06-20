import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  SPEAKER_ROLES_SYSTEM,
  SPEAKER_ROLES_SYSTEM_EN,
  speakerRolesSchema,
  type SpeakerRolesDecision,
} from './speaker-roles-schema';
import type { ElevenLabsWord } from './elevenlabs';
import type { DeepgramResult } from './format';

export type TranscriptLanguage = 'ko' | 'en';

const MODEL = 'claude-haiku-4-5-20251001';
const HEAD_TURNS = 15;
const MIN_TURNS = 3;
const SAMPLE_TEXT_CAP = 140;

function normalizeSpeaker(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  const m = /([0-9]+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

type Turn = { speaker: number; text: string };

function buildTurns(words: ElevenLabsWord[]): Turn[] {
  const turns: Turn[] = [];
  for (const w of words) {
    if (w.type === 'spacing' || typeof w.text !== 'string') continue;
    const speaker = normalizeSpeaker(w.speaker_id);
    const prev = turns[turns.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${w.text}`.trim();
    } else {
      turns.push({ speaker, text: w.text });
    }
  }
  return turns;
}

// Deepgram payload → same Turn[] shape. Prefer `results.utterances` (one row
// per speaker-segmented utterance) since that's already speaker-grouped.
// Fall back to per-word paragraphs if utterances is missing.
function buildTurnsFromDeepgram(result: DeepgramResult): Turn[] {
  const utterances = result.results?.utterances;
  if (utterances && utterances.length > 0) {
    const turns: Turn[] = [];
    for (const u of utterances) {
      const speaker = typeof u.speaker === 'number' ? u.speaker : 0;
      const text = (u.transcript ?? '').trim();
      if (!text) continue;
      const prev = turns[turns.length - 1];
      if (prev && prev.speaker === speaker) {
        prev.text = `${prev.text} ${text}`.trim();
      } else {
        turns.push({ speaker, text });
      }
    }
    return turns;
  }
  // No utterances → no reliable per-speaker grouping. Caller will treat
  // empty result as skip (too few turns).
  return [];
}

type SpeakerStats = { count: number; avgLen: number };

function speakerStats(turns: Turn[]): Record<number, SpeakerStats> {
  const buckets = new Map<number, { count: number; total: number }>();
  for (const t of turns) {
    let b = buckets.get(t.speaker);
    if (!b) {
      b = { count: 0, total: 0 };
      buckets.set(t.speaker, b);
    }
    b.count += 1;
    b.total += t.text.length;
  }
  const out: Record<number, SpeakerStats> = {};
  for (const [id, b] of buckets) {
    out[id] = { count: b.count, avgLen: Math.round(b.total / b.count) };
  }
  return out;
}

export type SpeakerRolesAudit = {
  skipped: boolean;
  reason?: string;
  model?: string;
  confidence?: SpeakerRolesDecision['confidence'];
  reasoning?: string;
  generated_at?: string;
};

export type SpeakerRoleEntry = { role: 'interviewer' | 'interviewee' | 'unknown'; n: number };
export type SpeakerRolesMap = Record<string, SpeakerRoleEntry>;

export type SpeakerRolesResult = {
  roles: SpeakerRolesMap | null;
  audit: SpeakerRolesAudit;
};

/**
 * Classify each diarized speaker as interviewer / interviewee / unknown + an
 * instance number, so the preview/download routes can render Korean labels
 * like "질문자 1" / "응답자 2" instead of raw "Speaker 1".
 *
 * Runs after speaker-merge + cleanup — the input `words` should already be
 * the post-merge, post-cleanup set so the speaker IDs we classify are the
 * final ones the user sees.
 *
 * Safe fallback: no API key / too few turns / LLM error → returns
 * `{ roles: null, audit }` and the caller leaves the column NULL.
 */
export async function classifySpeakerRoles(
  words: ElevenLabsWord[],
  filename: string,
): Promise<SpeakerRolesResult> {
  return classifyFromTurns(buildTurns(words), filename, 'ko');
}

/**
 * Deepgram counterpart — same classification, but reads `results.utterances`
 * to build the per-speaker turn list and uses the English prompt.
 */
export async function classifySpeakerRolesEn(
  result: DeepgramResult,
  filename: string,
): Promise<SpeakerRolesResult> {
  return classifyFromTurns(buildTurnsFromDeepgram(result), filename, 'en');
}

async function classifyFromTurns(
  turns: Turn[],
  filename: string,
  language: TranscriptLanguage,
): Promise<SpeakerRolesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { roles: null, audit: { skipped: true, reason: 'missing_api_key' } };
  }

  if (turns.length < MIN_TURNS) {
    return { roles: null, audit: { skipped: true, reason: 'too_few_turns' } };
  }

  const distinct = Array.from(new Set(turns.map((t) => t.speaker))).sort((a, b) => a - b);
  if (distinct.length === 0) {
    return { roles: null, audit: { skipped: true, reason: 'no_speakers' } };
  }

  const stats = speakerStats(turns);
  const statsLines = distinct
    .map((id) => {
      const s = stats[id];
      return `- Speaker ${id + 1}: ${s.count} turns, avg ${s.avgLen} chars`;
    })
    .join('\n');

  const head = turns.slice(0, HEAD_TURNS);
  const sampleLines = head
    .map((t) => `Speaker ${t.speaker + 1}: ${t.text.slice(0, SAMPLE_TEXT_CAP)}`)
    .join('\n');

  const prompt =
    language === 'en'
      ? `file: ${filename}
total speakers: ${distinct.length}
total turns: ${turns.length}

[per-speaker stats]
${statsLines}

[first ${head.length} turns]
${sampleLines}`
      : `파일: ${filename}
총 화자 수: ${distinct.length}
총 turn: ${turns.length}

[화자별 통계]
${statsLines}

[도입부 ${head.length} turn]
${sampleLines}`;

  let decision: SpeakerRolesDecision;
  try {
    const anthropic = createAnthropic({ apiKey });
    const llmResult = await generateObject({
      model: anthropic(MODEL),
      schema: speakerRolesSchema,
      system: language === 'en' ? SPEAKER_ROLES_SYSTEM_EN : SPEAKER_ROLES_SYSTEM,
      prompt,
      temperature: 0.1,
      maxOutputTokens: 1024,
    });
    decision = llmResult.object;
  } catch (e) {
    console.warn('[transcripts/speaker-roles] LLM call failed', e);
    return {
      roles: null,
      audit: {
        skipped: true,
        reason: e instanceof Error ? `llm_error: ${e.message.slice(0, 120)}` : 'llm_error',
      },
    };
  }

  // Fold the array into a speaker_id → {role,n} map. Speakers the LLM forgot
  // get unknown so downstream code never crashes on missing keys.
  const roles: SpeakerRolesMap = {};
  for (const id of distinct) {
    const assignment = decision.assignments.find((a) => a.speaker === id + 1);
    if (assignment) {
      roles[`speaker_${id}`] = { role: assignment.role, n: assignment.n };
    } else {
      roles[`speaker_${id}`] = { role: 'unknown', n: 1 };
    }
  }

  return {
    roles,
    audit: {
      skipped: false,
      model: MODEL,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      generated_at: new Date().toISOString(),
    },
  };
}

/**
 * Render-time helper: substitute "Speaker N:" tokens inside markdown / HTML
 * with role labels using a `speaker_roles` map. Safe to call with a
 * null/undefined map — returns the input unchanged. Used by preview, download,
 * and docx generation. Labels are rendered in the transcript's source language
 * ("질문자 1" / "응답자 1" for Korean, "Interviewer 1" / "Interviewee 1" for
 * English) — pass the job's STT language so downstream tools can read each
 * transcript in the same language as the audio.
 */
export function applySpeakerLabels(
  text: string,
  roles: SpeakerRolesMap | null | undefined,
  language: TranscriptLanguage = 'ko',
): string {
  if (!roles || !text) return text;

  // The markdown shape emitted by elevenlabsToMarkdown / deepgramToMarkdown is
  // `[HH:MM:SS] Speaker N: ...` (1-indexed N). Build a single replacer over
  // 1-indexed speaker numbers so callers can pass either raw or cleaned md.
  return text.replace(/Speaker (\d+):/g, (match, raw: string) => {
    const oneIndexed = Number(raw);
    if (!Number.isFinite(oneIndexed) || oneIndexed < 1) return match;
    const entry = roles[`speaker_${oneIndexed - 1}`];
    if (!entry) return match;
    if (entry.role === 'interviewer') {
      return language === 'en' ? `Interviewer ${entry.n}:` : `질문자 ${entry.n}:`;
    }
    if (entry.role === 'interviewee') {
      return language === 'en' ? `Interviewee ${entry.n}:` : `응답자 ${entry.n}:`;
    }
    return match;
  });
}
