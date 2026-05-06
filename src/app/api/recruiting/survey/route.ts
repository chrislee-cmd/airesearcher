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

const SYSTEM = `당신은 정량 리서치 설문 설계자입니다. 모집 브리프(대상자 조건 + 일정)를 받아, **Google Forms로 바로 발행 가능한 스크리너 + 본 설문**을 설계하세요.

엄격한 규칙:
- 출력은 정의된 JSON 스키마만. 그 외 텍스트 금지.
- 첫 섹션은 거의 항상 \`스크리닝\`. 모집 조건(criteria)을 검증하는 객관식·드롭다운 위주.
- 본 설문은 사용 경험, 구매 행태, 만족도(scale), 자유 의견(long_answer) 등을 자료에 맞게 구성.
- \`scale\`은 1~5 또는 1~7 중 적절한 것 선택. \`scaleMinLabel\`/\`scaleMaxLabel\`을 한국어로 채울 것.
- \`single_choice\`/\`multi_choice\`/\`dropdown\` 의 \`options\` 배열은 비울 수 없음(>=2). 그 외 질문은 빈 배열.
- 질문 수: 섹션당 3~8개, 전체 15~30개.
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
