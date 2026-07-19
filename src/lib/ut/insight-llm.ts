// AI UT 인사이트 클립 (card 626) — text-LLM steps (Anthropic). Three jobs:
//   1. planMoments   — 전사 turn + task_goal 로 UT 관심 순간 후보를 뽑는다.
//                      (Marengo 는 이 후보의 시간창을 refine 하는 보조 신호.)
//   2. analyzeClip   — Pegasus 실패/쿼터 시 구간 발화만으로 인사이트 폴백.
//   3. synthesize    — 클립 인사이트들을 세션 리포트로 종합.
// 출력 언어는 로케일에 따라 langDirective 로 지시(609 규칙, video-prompts 와 동형).
// 사용자 데이터(전사)는 wrapUserInput + ISOLATION_NOTICE 로 격리한다.

import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { wrapUserInput, ISOLATION_NOTICE } from '@/lib/llm/sanitize';
import type { TranscriptTurn } from '@/lib/transcripts/elevenlabs';

const MODEL = 'claude-sonnet-4-6';

function langDirective(locale: string): string {
  return locale === 'en'
    ? 'Write every string value in English.'
    : '모든 문자열 값을 한국어(존댓말)로 작성하세요.';
}

function anthropic() {
  const apiKey = env.ANTHROPIC_API_KEY;
  return createAnthropic({ apiKey });
}

function ms(t: number): string {
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
    .map((t, i) => `[${i}] ${ms(t.start_ms)}-${ms(t.end_ms)} (${t.start_ms}..${t.end_ms}ms) S${t.speaker}: ${t.text}`)
    .join('\n');

  const system = `당신은 UX 리서처입니다. 사용자 테스트(UT) 세션의 전사에서 **인사이트가 풍부한 순간**을 최대 ${maxMoments}개 고릅니다.
관심 순간의 예: 혼란/망설임, 오류·막힘, 주요 과제 단계, 강한 감정 반응, 중요한 발화.
각 순간에 대해:
- start_ms/end_ms 는 반드시 위 전사 turn 의 경계(…ms)에서 고르세요(발화 중간 자르기 금지). 필요하면 인접 turn 을 묶어 하나의 순간으로.
- theme: 짧은 라벨(예: "결제 버튼 위치 혼란").
- query: 그 순간을 영상에서 찾기 위한 시각/음성 묘사 한 문장(영상 검색용).
- relevance: 0~1, 인사이트 가치.
순간이 겹치지 않게, 시간 순으로. ${langDirective(locale)}`;

  const goalLine = taskGoal ? `과제 목표(분석 컨텍스트): ${taskGoal}\n\n` : '';
  const prompt = `${goalLine}전사(turn 단위, 타임스탬프 포함):\n${wrapUserInput(lines, 'ut_transcript')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: momentsSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
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
  const system = `당신은 UX 리서처입니다. UT 세션의 한 순간(구간 발화)을 분석해 다음을 요약합니다: 무슨 일이 있었는지(summary), 핵심 인용(quote, 발화에서 그대로), 마찰/어려움(friction), 감정(emotion), 심각도(severity: low|medium|high). 관찰된 사실만. ${langDirective(locale)}`;
  const goalLine = taskGoal ? `과제 목표: ${taskGoal}\n` : '';
  const prompt = `${goalLine}순간 테마: ${theme}\n\n구간 발화:\n${wrapUserInput(transcriptSpan || '(발화 없음)', 'ut_clip_span')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: clipInsightSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
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
  const system = `당신은 UX 리서처입니다. UT 세션의 클립별 인사이트들을 종합해 **세션 인사이트 리포트**를 만듭니다:
- overview: 세션 전체 3~5문장 요약.
- key_themes: 반복된 핵심 테마.
- top_frictions: 가장 중요한 마찰(각 항목의 clip_index 는 근거 클립 번호, 없으면 null).
- notable_quotes: 주목할 인용(clip_index 근거).
- task_outcome: 과제 목표 대비 성공/이탈 여부와 근거.
관찰된 사실만. ${langDirective(locale)}`;

  const goalLine = taskGoal ? `과제 목표(대비 평가 기준): ${taskGoal}\n\n` : '';
  const body = clips
    .map((c) => {
      const ins = c.insight;
      return [
        `클립 #${c.index} [${ms(c.start_ms)}-${ms(c.end_ms)}] 테마: ${c.theme ?? '-'}`,
        ins ? `  요약: ${ins.summary}` : '  요약: (분석 없음)',
        ins?.quote ? `  인용: ${ins.quote}` : '',
        ins?.friction ? `  마찰: ${ins.friction} (심각도 ${ins.severity})` : '',
        c.transcript_span ? `  발화: ${c.transcript_span.slice(0, 400)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const prompt = `${goalLine}클립 인사이트(번호는 clip_index 로 참조):\n${wrapUserInput(body || '(클립 없음)', 'ut_clip_insights')}`;

  const { object } = await generateObject({
    model: anthropic()(MODEL),
    schema: reportSchema,
    system: system + ISOLATION_NOTICE,
    prompt,
    temperature: 0.2,
    providerOptions: ZERO_RETENTION,
  });
  return { ...object, generated_at: nowIso };
}
