// probing-think — 새 우패널 (PR: probing-question-thinking-flow) 의 AI agent.
//
// 사용자가 입력한 **research_context** (조사 목적 / 핵심 가설 / KRQ) 와 누적
// transcript 를 받아 NDJSON-like 라인 스트림 (`THINK: ...` / `EMIT: <json>`)
// 으로 응답. 클라이언트가 줄 단위 buffer 로 dispatch — THINK 라인은 사고
// 흐름 영역에 append, EMIT 라인은 popup queue 에 push.
//
// 호출 주기: 위젯이 transcript 변경 debounce 5초 후 호출. inFlight 가드로
// 중복 호출 차단. 한 호출 = 사고 ~10-30 줄 + emit 0~5개.
//
// streamObject 대신 raw text stream (streamText) — line-prefix 라우팅이라
// JSON 트리 완성을 기다릴 필요 없음. 클라이언트는 fetch().body.getReader()
// 로 chunk 단위 decode 후 newline split.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  PROBING_OUTPUT_LANGS,
  buildProbingThinkSystem,
} from '@/lib/probing-prompts';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 60;

const Body = z.object({
  transcript_window: z.string().min(30).max(60_000),
  research_goal: z.string().max(2_000).optional().default(''),
  // 가설은 client 에서 string[] 로 보낸다. cap 은 항목 20개 / 항목 길이 500.
  hypotheses: z
    .array(z.string().min(1).max(500))
    .max(20)
    .optional()
    .default([]),
  key_research_question: z.string().max(2_000).optional().default(''),
  // 기존 자유 가이드 텍스트도 같이 받아 호환성 유지 (사용자가 옛 가이드를
  // 그대로 두고 새 3 필드만 채우는 마이그 경로).
  interview_guide: z.string().max(20_000).optional().default(''),
  // PR (probing-output-lang-select): 분석 출력 언어. 미전달 시 transcript
  // 주 언어 자동 추론 (옛 동작). 전달 시 그 언어로 강제.
  output_lang: z.enum(PROBING_OUTPUT_LANGS).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const {
    transcript_window,
    research_goal,
    hypotheses,
    key_research_question,
    interview_guide,
  } = parsed.data;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  const goalText = research_goal.trim();
  const krqText = key_research_question.trim();
  const hyps = hypotheses
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  const guideText = interview_guide.trim();

  const sanitizeCtx = {
    endpoint: '/api/probing/think',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
  };
  const transcriptSan = await sanitizeUserInput(
    transcript_window,
    'transcript',
    {
      ...sanitizeCtx,
      input_length: transcript_window.length,
      input_label: 'transcript',
    },
  );
  const goalSan = goalText
    ? await sanitizeUserInput(goalText, 'research_goal', {
        ...sanitizeCtx,
        input_length: goalText.length,
        input_label: 'research_goal',
      })
    : null;
  const krqSan = krqText
    ? await sanitizeUserInput(krqText, 'key_research_question', {
        ...sanitizeCtx,
        input_length: krqText.length,
        input_label: 'key_research_question',
      })
    : null;
  // 가설은 항목 단위 sanitize 후 묶어서 wrap. (한 묶음으로 wrap 해도 OK 였지만
  // 항목별 길이 / 잠재적 injection 패턴 점검을 위해 개별 호출.)
  const hypothesesSan = hyps.length
    ? await Promise.all(
        hyps.map((h, idx) =>
          sanitizeUserInput(h, 'hypothesis', {
            ...sanitizeCtx,
            input_length: h.length,
            input_label: `hypothesis_${idx + 1}`,
          }),
        ),
      )
    : [];
  const guideSan = guideText
    ? await sanitizeUserInput(guideText, 'interview_guide', {
        ...sanitizeCtx,
        input_length: guideText.length,
        input_label: 'interview_guide',
      })
    : null;

  const contextLines: string[] = [];
  if (goalSan) contextLines.push(`### 조사 목적\n${goalSan.wrapped}`);
  if (hypothesesSan.length) {
    const block = hypothesesSan
      .map((s, idx) => `${idx + 1}. ${s.wrapped}`)
      .join('\n');
    contextLines.push(`### 핵심 가설 (검증 / 반증 대상)\n${block}`);
  }
  if (krqSan) contextLines.push(`### Key Research Question\n${krqSan.wrapped}`);
  if (guideSan)
    contextLines.push(
      `### (참고) 자유 가이드 텍스트\n${guideSan.wrapped}\n위 3 필드와 모순될 때는 3 필드를 우선.`,
    );
  const contextBlock = contextLines.length
    ? `## 사용자가 제공한 조사 컨텍스트\n${contextLines.join('\n\n')}\n\n`
    : '## 사용자가 제공한 조사 컨텍스트\n(비어 있음 — transcript 만 보고 진행. emit 은 sharp 신호 있을 때만.)\n\n';

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildProbingThinkSystem(parsed.data.output_lang),
    prompt: `${contextBlock}## 누적 transcript
${transcriptSan.wrapped}

---
위 컨텍스트와 transcript 를 보며 사고하세요. 매 줄을 반드시 \`THINK: ...\` 또는 \`EMIT: {json}\` 으로 시작하세요. 그 외의 prefix / 빈 줄 / 코드 펜스는 절대 출력하지 마세요. EMIT 는 신호가 강할 때만 — 약한 일반 follow-up 은 emit X.`,
    // 0.4 — 같은 transcript 에서도 사고 흐름 / emit 타이밍이 약간씩 달라지도록.
    temperature: 0.4,
    // 사고 ~10-30 줄 + emit 0~5개 → 보통 1500~3000 토큰. cap 은 여유 있게.
    maxOutputTokens: 4000,
    providerOptions: ZERO_RETENTION,
  });

  return result.toTextStreamResponse({
    headers: {
      'x-probing-goal-length': String(goalText.length),
      'x-probing-hypotheses-count': String(hyps.length),
      'x-probing-krq-length': String(krqText.length),
      'x-probing-window-chars': String(transcript_window.length),
    },
  });
}
