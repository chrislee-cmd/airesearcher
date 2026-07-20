// AI UT 인사이트 클립 (card 626) — text-LLM steps (Anthropic). Three jobs:
//   1. planMoments   — pick UT moments of interest from transcript turns + task_goal.
//                      (Marengo only refines the time window of these candidates.)
//   2. analyzeClip   — fallback insight from the span transcript when Pegasus fails.
//   3. synthesize    — roll clip insights up into a session report.
// Prompt scaffolding is authored in English (never rendered as UI, keeps the
// Korean-literal guard clean); OUTPUT language is steered by langDirective per
// locale (609 규칙). User data (transcript) is isolated with wrapUserInput +
// ISOLATION_NOTICE.

import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { wrapUserInput, ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { TranscriptTurn } from '@/lib/transcripts/elevenlabs';

const MODEL = 'claude-sonnet-4-6';

// Per-call LLM deadline (ms). Bounds each generateObject so a hung Anthropic call
// can never pin the serverless step to the 300s platform limit (card 638 §1).
const LLM_TIMEOUT = 60_000;

// Output-language directive — English text only (no hardcoded Korean literal), so
// the model localizes its OUTPUT while the source stays guard-clean.
function langDirective(locale: string): string {
  return locale === 'en'
    ? 'Write all string values in English.'
    : 'Write all string values in Korean, using a polite, formal register.';
}

function anthropic() {
  const apiKey = env.ANTHROPIC_API_KEY;
  return createAnthropic({ apiKey });
}

function mmss(t: number): string {
  const total = Math.round(t / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── 1. Moment planning ─────────────────────────────────────────────────────
export type PlannedMoment = {
  start_ms: number;
  end_ms: number;
  theme: string;
  query: string;
  relevance: number;
};

const momentsSchema = z.object({
  moments: z
    .array(
      z.object({
        start_ms: z.number().int().nonnegative(),
        end_ms: z.number().int().nonnegative(),
        theme: z.string().min(1),
        query: z.string().min(1),
        relevance: z.number().min(0).max(1),
      }),
    )
    .max(8),
});

export async function planMoments(
  turns: TranscriptTurn[],
  taskGoal: string | null,
  locale: string,
  maxMoments = 6,
): Promise<PlannedMoment[]> {
  if (turns.length === 0) return [];
  // Feed turns as indexed lines so the model returns ms aligned to real turn
  // boundaries (clip cuts snap to utterance edges, never mid-sentence).
  const lines = turns
    .map((t, i) => `[${i}] ${mmss(t.start_ms)}-${mmss(t.end_ms)} (${t.start_ms}..${t.end_ms}ms) S${t.speaker}: ${t.text}`)
    .join('\n');

  const system = `You are a UX researcher. From the transcript of a usability test (UT) session, pick up to ${maxMoments} moments that are richest in insight.
Examples of moments of interest: confusion/hesitation, errors or getting stuck, key task steps, strong emotional reactions, important utterances.
For each moment:
- start_ms/end_ms MUST be chosen at the transcript turn boundaries above (the ...ms values). Never cut mid-utterance; merge adjacent turns into one moment when needed.
- theme: a short label (e.g. "Confusion about the checkout button").
- query: one sentence describing the visual/audio of that moment, for searching it in the video.
- relevance: 0..1, the insight value.
Keep moments non-overlapping and in time order. ${langDirective(locale)}`;

  const goalLine = taskGoal ? `Task goal (analysis context): ${taskGoal}\n\n` : '';
  const prompt = `${goalLine}Transcript (per turn, with timestamps):\n${wrapUserInput(lines, 'ut_transcript')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: momentsSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT),
    maxRetries: 2,
  });

  const dur = turns[turns.length - 1]?.end_ms ?? 0;
  return object.moments
    .map((m) => {
      const start = Math.max(0, Math.min(m.start_ms, m.end_ms));
      const end = Math.max(m.start_ms, m.end_ms);
      return {
        start_ms: start,
        end_ms: Math.min(end, dur > 0 ? dur : end),
        theme: m.theme.slice(0, 120),
        query: m.query.slice(0, 240),
        relevance: m.relevance,
      };
    })
    .filter((m) => m.end_ms > m.start_ms);
}

// ── 2. Text-only clip insight (Pegasus fallback) ───────────────────────────
export type ClipInsight = {
  summary: string;
  quote: string;
  friction: string;
  emotion: string;
  severity: 'low' | 'medium' | 'high';
  source: 'pegasus' | 'text';
};

const clipInsightSchema = z.object({
  summary: z.string(),
  quote: z.string().default(''),
  friction: z.string().default(''),
  emotion: z.string().default(''),
  severity: z.enum(['low', 'medium', 'high']).default('low'),
});

export async function analyzeClipText(
  transcriptSpan: string,
  theme: string,
  taskGoal: string | null,
  locale: string,
): Promise<ClipInsight> {
  const system = `You are a UX researcher. Analyze one moment (the span transcript) from a UT session and summarize: what happened (summary), a key verbatim quote (quote, empty if none), any friction/difficulty (friction), emotion (emotion), and severity (low|medium|high). Observed facts only. ${langDirective(locale)}`;
  const goalLine = taskGoal ? `Task goal: ${taskGoal}\n` : '';
  const themeLine = theme ? `Moment theme: ${theme}\n\n` : '\n';
  const prompt = `${goalLine}${themeLine}Span transcript:\n${wrapUserInput(transcriptSpan || '(no speech)', 'ut_clip_span')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: clipInsightSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT),
    maxRetries: 2,
  });
  return { ...object, source: 'text' };
}

// ── 3. Session insight report synthesis ────────────────────────────────────
export type ClipForReport = {
  index: number;
  theme: string | null;
  transcript_span: string | null;
  insight: ClipInsight | null;
  start_ms: number;
  end_ms: number;
};

export type InsightSummary = {
  overview: string;
  key_themes: Array<{ theme: string; detail: string }>;
  top_frictions: Array<{ title: string; detail: string; clip_index: number | null }>;
  notable_quotes: Array<{ quote: string; clip_index: number | null }>;
  task_outcome: string;
  generated_at: string;
};

const reportSchema = z.object({
  overview: z.string(),
  key_themes: z
    .array(z.object({ theme: z.string(), detail: z.string() }))
    .default([]),
  top_frictions: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        clip_index: z.number().int().nullable().default(null),
      }),
    )
    .default([]),
  notable_quotes: z
    .array(
      z.object({
        quote: z.string(),
        clip_index: z.number().int().nullable().default(null),
      }),
    )
    .default([]),
  task_outcome: z.string(),
});

export async function synthesizeReport(
  clips: ClipForReport[],
  taskGoal: string | null,
  locale: string,
  nowIso: string,
): Promise<InsightSummary> {
  const system = `You are a UX researcher. Synthesize the per-clip insights of a UT session into a session insight report:
- overview: 3-5 sentences summarizing the whole session.
- key_themes: recurring key themes.
- top_frictions: the most important frictions (each item's clip_index is the supporting clip number, or null).
- notable_quotes: noteworthy quotes (with supporting clip_index).
- task_outcome: success vs drop-off against the task goal, with evidence.
Observed facts only. ${langDirective(locale)}`;

  const goalLine = taskGoal ? `Task goal (the yardstick to evaluate against): ${taskGoal}\n\n` : '';
  const body = clips
    .map((c) => {
      const ins = c.insight;
      return [
        `Clip #${c.index} [${mmss(c.start_ms)}-${mmss(c.end_ms)}] theme: ${c.theme ?? '-'}`,
        ins ? `  summary: ${ins.summary}` : '  summary: (no analysis)',
        ins?.quote ? `  quote: ${ins.quote}` : '',
        ins?.friction ? `  friction: ${ins.friction} (severity ${ins.severity})` : '',
        c.transcript_span ? `  speech: ${c.transcript_span.slice(0, 400)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const prompt = `${goalLine}Clip insights (reference clips by clip_index number):\n${wrapUserInput(body || '(no clips)', 'ut_clip_insights')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: reportSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT),
    maxRetries: 2,
  });
  return { ...object, generated_at: nowIso };
}
