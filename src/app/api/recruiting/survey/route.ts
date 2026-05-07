import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';
import { surveySchema } from '@/lib/survey-schema';

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
- 섹션 구성 (오직 아래만 허용):
  1. \`기본 정보\` — 인구통계형 검증 (연령/지역/직업 등). 단, 이름·출생년도·성별·핸드폰 브랜드/모델은 여기 X.
  2. \`자격 조건\` — 행동·사용 경험·소속 검증 (사용 경험을 "심층"으로 묻지 말고 "예/아니오 또는 카테고리" 수준으로만).
  3. (선택) \`동의 및 일정\` — 개인정보 활용 동의 + 참여 가능 일정 체크만.
  4. \`인적사항\` — **마지막 섹션은 반드시 이 제목**. 다음 6개 질문을 정확히 이 순서대로 포함:
     1) 이름 (short_answer, 필수)
     2) 출생년도 (4자리) (short_answer, 필수, description "예: 1990")
     3) 성별 (single_choice, 필수, options: 여성/남성/응답하지 않음)
     4) 사용 중인 핸드폰 브랜드 (single_choice, 필수, options: 삼성/애플/기타)
     5) 핸드폰 기기 모델명 (short_answer, 필수, description "예: 아이폰 16, 갤럭시 S21")
     6) (long_answer, 필수) 제목: "만약 본인에게 자유롭게 사용할 수 있는 돈 100만원이 생긴다면, 어떻게 그 돈을 사용하고 싶으신가요? 저축은 할 수 없고 반드시 소비를 하셔야 합니다." — 응답 성의도 체크용. 변형·축약·재작성 금지.
- 전체 질문 수는 criteria 수에 비례. 일반적으로 5~12개 (인적사항 6개 포함하면 11~18). 절대 padding으로 늘리지 마세요.
- 설문 \`title\`은 "[프로젝트명] 사전 검토 설문" 형식으로 — "본 조사", "메인 설문" 같은 단어 금지.
- 설문 \`description\`은 모집 안내 + 1~2분 안내 + "적격자에게만 별도로 본 인터뷰 안내가 갑니다" 한 줄. 본 조사 내용 미리보기 X.
- 한국어로 작성.`;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: surveySchema,
    system: SYSTEM,
    prompt: `다음 모집 브리프로 설문을 설계하세요.\n\n${JSON.stringify(brief, null, 2)}`,
    temperature: 0.3,
  });

  return result.toTextStreamResponse();
}
