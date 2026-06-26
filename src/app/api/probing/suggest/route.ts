import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  PROBING_QUESTION_COUNT,
  PROBING_SYSTEM,
  buildProbingSuggestionSchema,
} from '@/lib/probing-prompts';

// 위젯 trigger 는 PR-13 부터 5초 주기 × 1 질문. 단일 호출이 5초 안에 끝날
// 필요는 없음 — client 의 inFlightRef 가드가 중복 호출 방지. Sonnet 4.6 의
// 1 질문 응답은 보통 1~3 초.
export const maxDuration = 60;

const Body = z.object({
  // ~500-1500 토큰 정도가 정상. cap 은 60_000 자 — 화자 모두 길게 떠들어도
  // 안전한 상한. 30글자 미만은 client 가 이미 skip 하지만 서버도 한 번 더 차단.
  transcript_window: z.string().min(30).max(60_000),
  // PR-2 범위 밖. client 는 빈 문자열로 보냄. 후속 PR 에서 interview_jobs
  // template 를 묶을 자리.
  interview_guide: z.string().max(20_000).optional().default(''),
  // PR-13: 클라이언트가 1 ~ PROBING_QUESTION_COUNT 사이를 보낸다. 기본값
  // 1 — 5초 주기 단일 질문. 풀-기법 batch 가 필요한 호출자는 명시적으로
  // PROBING_QUESTION_COUNT 를 보내면 된다.
  max_questions: z
    .number()
    .int()
    .min(1)
    .max(PROBING_QUESTION_COUNT)
    .optional()
    .default(1),
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
  const { transcript_window, interview_guide, max_questions } = parsed.data;
  const count = max_questions;
  const isSingle = count === 1;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  // 가이드는 transcript 보다 먼저 배치 — LLM 이 가이드의 가설 / 의도를
  // 1순위 기준으로 잡고 transcript 의 직전 발화를 그 의도에 대한 답변
  // 신호로 해석하도록. PROBING_SYSTEM 의 "가이드 활용" 섹션과 짝.
  const guideText = interview_guide.trim();
  const hasGuide = guideText.length > 0;
  const guideBlock = hasGuide
    ? `## 사용자가 제공한 가이드 (인터뷰 RQ / 가설 / 의도)\n${guideText}\n\n위 가이드가 모든 제안의 1순위 기준입니다. 각 질문이 가이드의 어느 부분과 정합되는지 \`guide_reference\` 에 명시하세요.\n\n`
    : '';

  // PR-13: count 가 1 이면 "모든 기법 각 1개씩" 룰을 한 호출에 적용할 수
  // 없으므로 "가장 정합되는 1 기법 선택" 으로 바꾼다. count 가 풀 길이면
  // 기존 PR-10 룰 유지.
  const techniqueRule = isSingle
    ? '정의된 기법 중 transcript / 가이드 와 가장 정합되는 **1 기법** 을 선택해 1 질문만 생성하세요.'
    : `정의된 ${PROBING_QUESTION_COUNT}개 기법 중 ${count}개를 선택, 각 기법은 정확히 1번씩 등장 (technique 값이 중복되면 안 됨).`;
  const closingInstruction = hasGuide
    ? `위 가이드와 transcript 를 기반으로 **${count}개의 probing 질문** 을 제안하세요. ${techniqueRule} 응답자의 직전 발화에서 출발하되, 가이드의 가설 / 의도 검증을 우선합니다.`
    : `위 transcript 를 기반으로 **${count}개의 probing 질문** 을 제안하세요. ${techniqueRule} 응답자의 직전 발화에서 출발하세요.`;

  const schema = buildProbingSuggestionSchema(count);
  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema,
    system: PROBING_SYSTEM,
    prompt: `${guideBlock}## Transcript (최근 ~90초)
${transcript_window}

---
${closingInstruction} \`questions\` 의 ${count}개 핵심을 먼저 emit 한 뒤 \`intents\` 를 같은 순서로 emit 해주세요.`,
    // 0.4 — 같은 transcript 에서도 매 호출마다 약간 다른 각도가 제안되도록.
    // 0 에 두면 거의 동일한 질문이 반복돼 위젯 가치가 떨어짐.
    temperature: 0.4,
    // PR-13: 1 질문이면 ~200 token, 풀 batch 면 ~2000 token. count 에 비례.
    maxOutputTokens: isSingle ? 400 : 2000,
    providerOptions: ZERO_RETENTION,
  });

  // 디버그 헤더 — preview / 운영에서 가이드와 count 가 실제로 전송됐는지
  // 빠르게 확인. 운영 영향 0, 인증된 사용자만 호출하므로 보안 노출 아님.
  return result.toTextStreamResponse({
    headers: {
      'x-probing-guide-length': String(guideText.length),
      'x-probing-question-count': String(count),
    },
  });
}
