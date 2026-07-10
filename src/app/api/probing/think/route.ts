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
import {
  EMPTY_FILL_THRESHOLD,
  sortWidgetsByPriority,
} from '@/lib/probing-widget-weight';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 60;

const Body = z.object({
  transcript_window: z.string().min(30).max(60_000),
  research_goal: z.string().max(2_000).optional().default(''),
  // hypotheses 는 은퇴됨 (PR: probing-hypotheses-retire-ghost-injection). 클라는
  // 더 이상 전송하지 않고, 옛 클라가 보내도 zod 가 unknown key 로 strip → 프롬프트
  // 에 핵심가설 블록이 붙지 않는다 (유령 주입 근절). 스키마에서 완전 제거.
  key_research_question: z.string().max(2_000).optional().default(''),
  // 기존 자유 가이드 텍스트도 같이 받아 호환성 유지 (사용자가 옛 가이드를
  // 그대로 두고 새 3 필드만 채우는 마이그 경로).
  interview_guide: z.string().max(20_000).optional().default(''),
  // PR (probing-question-injection-input-to-widget): 사용자가 "주입" 버튼으로
  // **이번 turn 에만** 밀어 넣는 즉시 질문. one-shot — 이 호출에서만 프롬프트에
  // 들어가고 다음 자동 think 엔 안 실린다 (옛 영구 재주입 hypotheses 를 대체).
  injected_questions: z
    .array(z.string().min(1).max(500))
    .max(10)
    .optional()
    .default([]),
  // PR (probing-custom-widget-backfill-and-priority-question): 사용자가 추가한
  // 커스텀 조사 위젯 중 backfill 후에도 대화에서 관련 내용이 안 나온 (empty)
  // 항목들. AI 가 이 위젯들을 채우는 probing 질문을 우선 제안하도록 넘긴다.
  // 미전달 / 빈 배열이면 옛 동작 (우선 대상 없음).
  priority_sections: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().max(1000).optional().default(''),
      }),
    )
    .max(16)
    .optional()
    .default([]),
  // PR (probing-output-lang-select): 분석 출력 언어. 미전달 시 transcript
  // 주 언어 자동 추론 (옛 동작). 전달 시 그 언어로 강제.
  output_lang: z.enum(PROBING_OUTPUT_LANGS).optional(),
  // PR (probing-custom-widget-priority-weight): 페르소나 위젯별 채움 상태 +
  // 가중치. custom 위젯 (weight 1.0) 이 비어 있으면 그 위젯을 채우는 질문을
  // 우선 emit 하도록 프롬프트에 우선순위 블록으로 반영한다. 미전달 / 빈 배열
  // 이면 옛 동작 (위젯 우선순위 없이 신호 기반 emit) 100% 보존.
  widget_status: z
    .array(
      z.object({
        alias: z.string().min(1).max(64),
        label: z.string().min(1).max(160),
        weight: z.number().min(0).max(1),
        fill_rate: z.number().min(0).max(1),
        is_custom: z.boolean(),
      }),
    )
    .max(24)
    .optional()
    .default([]),
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
    key_research_question,
    interview_guide,
    injected_questions,
    widget_status,
    priority_sections,
  } = parsed.data;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  const goalText = research_goal.trim();
  const krqText = key_research_question.trim();
  const guideText = interview_guide.trim();
  const injected = injected_questions
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  const prioritySections = priority_sections
    .map((s) => ({ title: s.title.trim(), description: s.description.trim() }))
    .filter((s) => s.title.length > 0);

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
  const guideSan = guideText
    ? await sanitizeUserInput(guideText, 'interview_guide', {
        ...sanitizeCtx,
        input_length: guideText.length,
        input_label: 'interview_guide',
      })
    : null;
  const injectedSan = injected.length
    ? await Promise.all(
        injected.map((q, idx) =>
          sanitizeUserInput(q, 'injected_question', {
            ...sanitizeCtx,
            input_length: q.length,
            input_label: `injected_question_${idx + 1}`,
          }),
        ),
      )
    : [];
  const prioritySan = prioritySections.length
    ? await Promise.all(
        prioritySections.map(async (s, idx) => {
          const titleSan = await sanitizeUserInput(s.title, 'priority_title', {
            ...sanitizeCtx,
            input_length: s.title.length,
            input_label: `priority_title_${idx + 1}`,
          });
          const descSan = s.description
            ? await sanitizeUserInput(s.description, 'priority_description', {
                ...sanitizeCtx,
                input_length: s.description.length,
                input_label: `priority_description_${idx + 1}`,
              })
            : null;
          return { title: titleSan.wrapped, description: descSan?.wrapped ?? '' };
        }),
      )
    : [];

  const contextLines: string[] = [];
  if (goalSan) contextLines.push(`### 조사 목적\n${goalSan.wrapped}`);
  // hypotheses 는 은퇴 — 프롬프트에 "핵심 가설" 블록을 삽입하지 않는다
  // (유령 주입 근절, PR: probing-hypotheses-retire-ghost-injection).
  if (krqSan) contextLines.push(`### Key Research Question\n${krqSan.wrapped}`);
  if (guideSan)
    contextLines.push(
      `### (참고) 자유 가이드 텍스트\n${guideSan.wrapped}\n위 3 필드와 모순될 때는 3 필드를 우선.`,
    );
  const contextBlock = contextLines.length
    ? `## 사용자가 제공한 조사 컨텍스트\n${contextLines.join('\n\n')}\n\n`
    : '## 사용자가 제공한 조사 컨텍스트\n(비어 있음 — transcript 만 보고 진행. emit 은 sharp 신호 있을 때만.)\n\n';

  // 사용자가 방금 "주입" 버튼으로 밀어 넣은 질문 — 이번 turn 한정. 일반 emit
  // 판단 룰을 우회해 **각 질문을 반드시 EMIT 으로 즉시 노출**한다 (transcript
  // 맥락에 맞게 표현만 다듬어도 됨). 다음 자동 think 호출엔 안 실린다.
  const injectedBlock = injectedSan.length
    ? `## ⚡ 사용자가 방금 직접 주입한 질문 (이번 turn 필수 처리)
${injectedSan.map((s, idx) => `${idx + 1}. ${s.wrapped}`).join('\n')}

위 각 질문은 인터뷰어가 **지금 즉시 던지려고 직접 밀어 넣은** 것입니다. 일반 emit 판단 룰(신호 강도)과 무관하게, 각 질문을 이번 응답에서 반드시 \`EMIT:\` 라인으로 즉시 노출하세요. transcript 맥락에 맞게 문장을 자연스럽게 다듬는 것은 허용하되 의도는 보존하고, importance 는 high 로, rationale 에는 "사용자 직접 주입" 임을 명시하세요.

`
    : '';

  // PR (probing-custom-widget-priority-weight): 위젯 채움 상태 → 우선순위 블록.
  // 점수 (weight × (1-fill)) 내림차순으로 정렬해 LLM 이 상위 위젯부터 채우도록.
  // 라벨은 사용자 custom 제목을 포함할 수 있으나 alias / weight / fill 은 구조
  // 메타라 transcript 처럼 injection 위험이 낮다 — reflection route 가 custom
  // 제목을 sanitize 없이 schema 라벨로 쓰는 것과 동일 취급. 빈 배열이면 블록
  // 생략 → 옛 동작.
  const widgetBlock = widget_status.length
    ? `## 위젯 채우기 우선순위
아래는 좌패널 페르소나 위젯들의 현재 채움 상태입니다. 우선순위 점수 (weight × (1 − fill_rate)) 내림차순 정렬 — 상위 위젯일수록 지금 채워야 할 대상입니다. empty 임계값은 fill ${Math.round(EMPTY_FILL_THRESHOLD * 100)}% 미만.

${sortWidgetsByPriority(widget_status)
        .map((w) => {
          const kind = w.is_custom
            ? 'custom'
            : w.weight <= 0.3
              ? '기타'
              : 'default';
          const fillPct = Math.round(w.fill_rate * 100);
          const empty = w.fill_rate < EMPTY_FILL_THRESHOLD ? ' ← EMPTY' : '';
          return `- alias="${w.alias}" [${kind}, weight ${w.weight.toFixed(1)}] "${w.label}" — 채움 ${fillPct}%${empty}`;
        })
        .join('\n')}

custom 위젯이 EMPTY 이면 그 위젯을 채우는 sharp 질문을 최우선으로 emit 하고 target_section 에 해당 alias 를 적으세요. 단 응답자 발화에 hook 되지 않는 억지 질문은 금지.

`
    : '';

  // PR (probing-custom-widget-backfill-and-priority-question): 새로 추가돼 backfill
  // 후에도 대화에서 관련 내용이 안 나온 커스텀 위젯. widget_status (fill_rate 기반)
  // 와 목적은 같지만, 이쪽은 backfill 즉시 empty 로 판정된 신규 위젯을 client 가
  // 명시 전달하는 경로다 (fill_rate 계산 전에도 우선 반영). 둘 다 있으면 서로
  // 보강 — 흐름을 해치지 않는 선에서 우선 EMIT. 빈 배열이면 블록 생략.
  const priorityBlock = prioritySan.length
    ? `## 🎯 아직 비어 있는 조사 위젯 (우선 채우기 대상)
${prioritySan
  .map((s, idx) =>
    s.description
      ? `${idx + 1}. ${s.title} — 조사 의도: ${s.description}`
      : `${idx + 1}. ${s.title}`,
  )
  .join('\n')}

위 위젯들은 사용자가 조사하려고 추가했으나 대화에서 아직 관련 내용이 나오지 않았습니다. 대화 흐름을 부자연스럽게 끊지 않는 선에서, 이 위젯들을 채울 수 있는 방향의 probing 질문을 **일반 follow-up 보다 우선** 해서 EMIT 하세요. 이미 충분히 다뤄진 위젯은 무시해도 됩니다.

`
    : '';

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildProbingThinkSystem(parsed.data.output_lang),
    prompt: `${contextBlock}${widgetBlock}${injectedBlock}${priorityBlock}## 누적 transcript
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
      'x-probing-krq-length': String(krqText.length),
      'x-probing-injected-count': String(injected.length),
      'x-probing-priority-count': String(prioritySections.length),
      'x-probing-window-chars': String(transcript_window.length),
    },
  });
}
