import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 120;

const Body = z.object({
  criteria: z.array(
    z.object({
      category: z.string(),
      label: z.string(),
      detail: z.string(),
      required: z.boolean(),
    }),
  ),
  columns: z.array(z.object({ questionId: z.string(), title: z.string() })),
  rows: z.array(
    z.object({
      responseId: z.string(),
      answers: z.record(z.string(), z.string()),
    }),
  ),
});

const ScoresSchema = z.object({
  scores: z.array(
    z.object({
      responseId: z.string(),
      percent: z.number().min(0).max(100),
      failedQuestionIds: z.array(z.string()),
    }),
  ),
});

const SYSTEM = `당신은 모집 스크리너 응답을 채점하는 평가자입니다. 입력으로 (a) 모집 조건 목록, (b) 폼 질문 목록(questionId+title), (c) 응답자별 답변(answers: questionId → 텍스트)을 받습니다.

각 응답자에 대해:
- 모든 조건(criteria)을 답변과 비교해 부합 여부를 판단.
- \`required\` 조건만 percent 산출에 사용. 우대(non-required) 조건은 fail로 표시하지 말 것.
- percent = (충족된 required 조건 수 / 전체 required 조건 수) × 100. 정수로 반올림.
- required 조건이 0개면 percent=100.
- \`failedQuestionIds\`: required 조건을 위반·불충분하게 답한 **질문의 questionId 목록**. 답변이 비어있어 조건을 검증할 수 없는 경우도 fail로 본다. 한 questionId가 여러 조건에 매핑돼도 한 번만 포함.
- 조건과 직접 관련 없는 인적사항(이름·출생년도·성별·핸드폰)이나 자유 서술 응답은 채점 대상이 아니므로 fail에 넣지 말 것.
- 출력은 정의된 JSON 스키마만.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { criteria, columns, rows } = parsed.data;
  if (rows.length === 0) {
    return NextResponse.json({ scores: [] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: ScoresSchema,
      system: SYSTEM,
      prompt: `## 모집 조건 (criteria)\n${JSON.stringify(criteria, null, 2)}\n\n## 폼 질문 (columns)\n${JSON.stringify(columns, null, 2)}\n\n## 응답자 답변 (rows)\n${JSON.stringify(rows, null, 2)}`,
      temperature: 0,
    });
    return NextResponse.json(object);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'score_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
