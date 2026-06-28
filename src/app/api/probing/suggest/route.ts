import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  PROBING_QUESTION_COUNT,
  PROBING_SYSTEM,
  buildProbingSuggestionSchema,
} from '@/lib/probing-prompts';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

// 위젯 trigger 는 PR-14 부터 30초 주기 × 3 질문. 한 호출이 30초 안에 끝날
// 필요는 없음 — client 의 inFlightRef 가드가 중복 호출 방지. Sonnet 4.6 의
// 3 질문 응답은 보통 3~6 초.
export const maxDuration = 60;

const Body = z.object({
  // ~500-1500 토큰 정도가 정상. cap 은 60_000 자 — 화자 모두 길게 떠들어도
  // 안전한 상한. 30글자 미만은 client 가 이미 skip 하지만 서버도 한 번 더 차단.
  transcript_window: z.string().min(30).max(60_000),
  // PR-2 범위 밖. client 는 빈 문자열로 보냄. 후속 PR 에서 interview_jobs
  // template 를 묶을 자리.
  interview_guide: z.string().max(20_000).optional().default(''),
  // PR (probing-two-pane-reflection): 좌패널 Reflection Agent 가 만든 응답자
  // 성찰 텍스트 (respondent / needs_painpoints / motivation 합본). 우패널
  // Question Agent 가 이 성찰의 **검증·심화** 질문을 만들 때 1순위 컨텍스트.
  // 비어 있어도 (좌패널 아직 미생성) 안전 — transcript 만 보고 진행.
  reflection_context: z.string().max(20_000).optional().default(''),
  // PR-13/14: 클라이언트가 1 ~ PROBING_QUESTION_COUNT 사이를 보낸다. 기본값
  // 3 — 30초 주기 sharp 3 질문 묶음 (PR-14). 풀-기법 batch 가 필요한 호출자
  // 는 명시적으로 PROBING_QUESTION_COUNT 를 보내면 된다.
  max_questions: z
    .number()
    .int()
    .min(1)
    .max(PROBING_QUESTION_COUNT)
    .optional()
    .default(3),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { transcript_window, interview_guide, reflection_context, max_questions } =
    parsed.data;
  const count = max_questions;
  const isSingle = count === 1;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  // 가이드는 transcript 보다 먼저 배치 — LLM 이 가이드의 가설 / 의도를
  // 1순위 기준으로 잡고 transcript 의 직전 발화를 그 의도에 대한 답변
  // 신호로 해석하도록. PROBING_SYSTEM 의 "가이드 활용" 섹션과 짝.
  //
  // PR-SEC9: 사용자 입력 (transcript / guide) 는 XML delimiter 로 격리하고
  // 의심 패턴은 audit_log 에 기록. 차단은 안 함 (false positive 회피).
  const guideText = interview_guide.trim();
  const reflectionText = reflection_context.trim();
  const hasGuide = guideText.length > 0;
  const hasReflection = reflectionText.length > 0;
  const sanitizeCtx = {
    endpoint: '/api/probing/suggest',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
  };
  const transcriptSan = await sanitizeUserInput(transcript_window, 'transcript', {
    ...sanitizeCtx,
    input_length: transcript_window.length,
    input_label: 'transcript',
  });
  const guideSan = hasGuide
    ? await sanitizeUserInput(guideText, 'interview_guide', {
        ...sanitizeCtx,
        input_length: guideText.length,
        input_label: 'interview_guide',
      })
    : null;
  const reflectionSan = hasReflection
    ? await sanitizeUserInput(reflectionText, 'reflection_context', {
        ...sanitizeCtx,
        input_length: reflectionText.length,
        input_label: 'reflection_context',
      })
    : null;
  const guideBlock = guideSan
    ? `## 사용자가 제공한 가이드 (인터뷰 RQ / 가설 / 의도)\n${guideSan.wrapped}\n\n위 가이드가 모든 제안의 1순위 기준입니다. 각 질문이 가이드의 어느 부분과 정합되는지 \`guide_reference\` 에 명시하세요.\n\n`
    : '';
  // 좌패널 Reflection Agent 가 만든 응답자 성찰 — 우패널 (이 endpoint) 의
  // 질문은 이 가설들을 **검증** 하거나 더 깊이 **probing** 하는 방향이 1순위.
  const reflectionBlock = reflectionSan
    ? `## 좌패널 응답자 성찰 (Reflection Agent 결과)\n${reflectionSan.wrapped}\n\n각 probing 질문은 위 성찰의 **어느 가설을 검증·심화** 하는지 명확해야 합니다. \`why_sharp\` 에 어느 성찰 가설을 hook 했는지 간단히 표기하세요. transcript 와 성찰이 모순될 때는 모순을 가시화하는 질문을 우선.\n\n`
    : '';

  // PR-13/14: count 에 따라 기법 분배 룰을 다르게 보낸다.
  //  - count = 1 (legacy): "가장 정합되는 1 기법 선택" — 한 호출에 "모든
  //    기법 각 1개씩" 룰은 적용 불가.
  //  - count = PROBING_QUESTION_COUNT (풀 batch): PR-10 룰 그대로 — 5개
  //    기법 각 1개씩.
  //  - 그 외 (PR-14 의 기본값 3 등): 5개 기법 중 가장 정합되는 N 개 선택,
  //    중복 없음. PROBING_SYSTEM 의 sharpness 룰이 기법 다양화보다 우선.
  const techniqueRule = isSingle
    ? '정의된 기법 중 transcript / 가이드 와 가장 정합되는 **1 기법** 을 선택해 1 질문만 생성하세요.'
    : count >= PROBING_QUESTION_COUNT
      ? `정의된 ${PROBING_QUESTION_COUNT}개 기법 각 1개씩 (technique 값이 중복되면 안 됨).`
      : `정의된 ${PROBING_QUESTION_COUNT}개 기법 중 transcript / 가이드 의 hook 신호와 가장 정합되는 **${count}개** 각도를 선택해 ${count} 질문을 만드세요. **기법 다양화보다 PROBING_SYSTEM 의 sharpness / why 깊이 / 맥락 hook 룰이 항상 우선**.`;
  const closingInstruction = hasGuide
    ? `위 가이드와 transcript 를 기반으로 **${count}개의 날카로운 probing 질문** 을 제안하세요. ${techniqueRule} 직전 30초 발화의 구체 단어 / 망설임 / 모순에서 출발하되, 가이드의 가설 / 의도 검증을 우선합니다.`
    : `위 transcript 를 기반으로 **${count}개의 날카로운 probing 질문** 을 제안하세요. ${techniqueRule} 직전 30초 발화의 구체 단어 / 망설임 / 모순에서 출발하세요.`;

  const schema = buildProbingSuggestionSchema(count);
  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema,
    system: PROBING_SYSTEM,
    prompt: `${guideBlock}${reflectionBlock}## Transcript (최근 ~30초)
${transcriptSan.wrapped}

---
${closingInstruction} 각 질문에 \`why_sharp\` (응답자의 어느 발화 신호를 hook 했는지 한 줄) 를 반드시 채우세요. \`questions\` 의 ${count}개 핵심을 먼저 emit 한 뒤 \`intents\` 를 같은 순서로 emit 해주세요.`,
    // 0.4 — 같은 transcript 에서도 매 호출마다 약간 다른 각도가 제안되도록.
    // 0 에 두면 거의 동일한 질문이 반복돼 위젯 가치가 떨어짐.
    temperature: 0.4,
    // PR-13/14: 1 질문 ~400 / 3 질문 ~1200 / 풀 batch ~2000 token. why_sharp
    // 메타 추가로 질문당 ~100 token 여유 더 둠.
    maxOutputTokens: isSingle ? 400 : count >= PROBING_QUESTION_COUNT ? 2000 : 1600,
    providerOptions: ZERO_RETENTION,
  });

  // 디버그 헤더 — preview / 운영에서 가이드 / count / window 크기가 실제로
  // 전송됐는지 빠르게 확인. 운영 영향 0, 인증된 사용자만 호출하므로 보안
  // 노출 아님. window-chars 는 client 의 30초 window 추출이 정상 동작하는지
  // 검증용 (PR-14).
  return result.toTextStreamResponse({
    headers: {
      'x-probing-guide-length': String(guideText.length),
      'x-probing-reflection-length': String(reflectionText.length),
      'x-probing-question-count': String(count),
      'x-probing-window-chars': String(transcript_window.length),
    },
  });
}
