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

const SYSTEM = `당신은 리서치 모집 **스크리닝 설문(Screening Survey)** 설계자입니다. 입력으로 받은 모집 브리프의 **대상자 조건(criteria)** 을 검증해, 적격자만 통과시키기 위한 설문을 설계합니다. 본 조사(메인 아젠다)에 대한 질문은 절대 포함하지 마세요.

목적은 단 하나: **응답자가 모집 조건에 부합하는지 필터링**.

엄격한 규칙:
- 출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.
- 모든 질문은 brief의 \`criteria\` 항목 중 하나를 직접 검증해야 함. 사용 경험 심층, 구매 동기, 만족도, 의견·아이디어 같은 **본 조사용 질문은 금지**.
- 질문 형식은 \`single_choice\`, \`multi_choice\`, \`dropdown\`, \`short_answer\`(나이/지역 등 사실 응답) 위주. \`scale\`과 \`long_answer\`는 사용하지 마세요 — 스크리닝에는 부적합.
- 각 criteria 1개당 1~2개의 검증 질문. 검증 질문은 모두 \`required: true\`.
- 옵션 설계 원칙: 적격(통과) 옵션과 부적격(탈락) 옵션이 명확히 갈리도록 구성. "기타"는 필요할 때만. 옵션 수 2~6개.
- 질문의 \`description\`에는 **응답자에게 어떤 criteria를 검증한다는 사실을 절대 노출하지 마세요.** "연령대 검증", "○○ 조건 확인" 같은 내부 메모성 문장 금지. description은 비워두거나, 응답자가 응답 방법을 헷갈릴 때만 짧은 안내문(예: "최근 6개월 기준")을 넣을 것.
- 섹션 구성:
  1. \`기본 정보\` — 인구통계형 조건(연령/성별/지역/직업 등).
  2. \`자격 조건\` — 행동·사용 경험·소속 등 나머지 criteria.
  3. (선택) \`동의 및 일정\` — 개인정보 활용 동의, 참여 가능 일정 확인 정도만. 본 조사 내용 묻지 말 것.
- 전체 질문 수는 criteria 수에 비례. 일반적으로 6~14개. 절대 padding으로 늘리지 마세요.
- 첫 인사말(\`description\`)은 모집 안내 + 소요 시간(1~2분) + 적격자에게만 본 조사 안내가 갈 것이라는 점을 짧게 안내.
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
