import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';
import { surveySchema } from '@/lib/survey-schema';
import { ISOLATION_NOTICE, sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 300;

const Body = z.object({ brief: recruitingBriefSchema });

const SYSTEM = `당신은 리서치 모집 **스크리너 설문(Screening Survey) 전용** 설계자입니다. 출력은 **오직 스크리너만**입니다. **본 조사(메인 아젠다)는 별개의 인터뷰에서 진행되며, 이 설문에 절대 포함되지 않습니다.**

목적은 단 하나: **응답자가 모집 조건에 부합하는지 필터링**.

⛔ 절대 금지 (위반 시 부적합 출력):
- "본 설문", "메인 설문", "사용 경험", "구매 행태", "구매 동기", "만족도", "선호도", "기대", "의견", "아이디어", "추천 의향" 같은 본 조사용 질문 또는 섹션.
- \`scale\` 질문 (인적사항 마지막 long_answer 1개 외에는 \`long_answer\`도 금지).
- 질문이 brief의 \`criteria\`와 무관한 경우.
- "스크리너 외 추가 질문", "심층 탐색", "본 조사로의 연결" 같은 어떤 식이든 본 조사 진입을 시도하는 질문.

엄격한 규칙:
- 출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.
- 모든 질문은 brief의 \`criteria\` 항목 중 하나를 직접 검증. 검증 외 목적의 질문은 0개.
- 질문 형식: \`single_choice\`, \`multi_choice\`, \`dropdown\`, \`short_answer\` 위주.
- 각 criteria 1개당 1~2개의 검증 질문. 모두 \`required: true\`.
- 옵션 설계: 적격(통과)/부적격(탈락) 분기가 명확하게. "기타"는 필요할 때만. 옵션 수 2~6개.
- 질문 \`description\`에는 응답자에게 검증 의도를 절대 노출 X. 빈 문자열 또는 응답 방식 안내(예: "최근 6개월 기준")만.

🚫 **표준 영역은 절대 생성하지 마세요 (시스템이 자동 삽입)**:
- \`개인정보 수집 동의\` 섹션 / 동의 질문 — 시스템이 첫 번째 섹션으로 고정 삽입. 만들지 마세요.
- \`인적사항\` 섹션 (이름 / 출생년도 / 성별 / 핸드폰 브랜드 / 기기 모델명 / 100만원 성의도 질문) — 시스템이 마지막 섹션으로 고정 삽입. 만들지 마세요.
- \`연락 가능한 전화번호\` / 연락처 질문 — 시스템이 자동 삽입. 만들지 마세요.
이 표준 영역들은 모든 설문에 동일하게 박히는 고정 template 입니다. 당신이 만들면 중복되어 제거됩니다 — **토큰 낭비이니 처음부터 생성하지 마세요.**

- 섹션 구성 — **도메인 스크리닝 섹션만** 생성 (오직 아래만 허용):
  1. \`기본 정보\` — 인구통계형 검증 (연령/지역/직업 등). 단, 이름·출생년도·성별·핸드폰 브랜드/모델은 여기 X (표준 영역).
  2. \`자격 조건\` — 행동·사용 경험·소속 검증 (사용 경험을 "심층"으로 묻지 말고 "예/아니오 또는 카테고리" 수준으로만).
  3. (선택) \`동의 및 일정\` — 참여 가능 일정 체크만 (개인정보 동의는 표준 영역이므로 여기 X).
- 도메인 질문 수는 criteria 수에 비례. 일반적으로 5~12개 (표준 영역 제외). 절대 padding으로 늘리지 마세요.
- 설문 \`title\`은 "[프로젝트명] 사전 검토 설문" 형식으로 — "본 조사", "메인 설문" 같은 단어 금지.
- 설문 \`description\`은 모집 안내 + 1~2분 안내 + "적격자에게만 별도로 본 인터뷰 안내가 갑니다" 한 줄. 본 조사 내용 미리보기 X.
- 한국어로 작성.${ISOLATION_NOTICE}`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { brief } = parsed.data;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const briefJson = JSON.stringify(brief, null, 2);
  const briefSan = await sanitizeUserInput(briefJson, 'recruiting_brief', {
    endpoint: '/api/recruiting/survey',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: briefJson.length,
    input_label: 'recruiting_brief',
  });
  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: surveySchema,
    system: SYSTEM,
    prompt: `다음 모집 브리프로 설문을 설계하세요.\n\n${briefSan.wrapped}`,
    temperature: 0.3,
    providerOptions: ZERO_RETENTION,
  });

  return result.toTextStreamResponse();
}
