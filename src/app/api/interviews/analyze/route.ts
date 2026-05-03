import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const maxDuration = 300;

const Body = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        markdown: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

const SYSTEM = `당신은 마케팅·UX 리서치 분석가입니다.
여러 인터뷰 마크다운 노트를 입력 받아 다음을 수행합니다:
1) 모든 인터뷰에서 일관되게 다루어진 "기준 문항" 목록을 추출합니다. 비슷한 의도의 질문은 하나의 표준 문항으로 통합합니다.
2) 각 기준 문항에 대해, 입력된 파일별로:
   - "summary" — 해당 응답자의 답을 1~2문장으로 요약 (사실만, 평가 금지)
   - "voc" — 응답자의 발언을 그대로 옮긴 한 줄 인용구 (Voice of Customer). 큰따옴표는 포함하지 마세요.
3) 한 응답자가 해당 문항에 답하지 않았다면 summary와 voc 모두 빈 문자열로 둡니다.
출력은 정의된 JSON 스키마를 정확히 따르고, 그 외 텍스트는 포함하지 마세요. 한국어로 작성하세요.`;

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
  const { files } = parsed.data;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
  const openai = new OpenAI({ apiKey });

  const userPrompt = files
    .map(
      (f, idx) =>
        `## File ${idx + 1}: ${f.filename}\n\n${f.markdown.slice(0, 12000)}`,
    )
    .join('\n\n---\n\n');

  let result: {
    questions: string[];
    rows: { question: string; cells: { filename: string; summary: string; voc: string }[] }[];
  };

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'interview_matrix',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              questions: {
                type: 'array',
                items: { type: 'string' },
              },
              rows: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    question: { type: 'string' },
                    cells: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          filename: { type: 'string' },
                          summary: { type: 'string' },
                          voc: { type: 'string' },
                        },
                        required: ['filename', 'summary', 'voc'],
                      },
                    },
                  },
                  required: ['question', 'cells'],
                },
              },
            },
            required: ['questions', 'rows'],
          },
        },
      },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? '{}';
    result = JSON.parse(content);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'analyze_failed' },
      { status: 502 },
    );
  }

  // Persist + spend a single 'interviews' credit (3) per analysis run.
  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'interviews',
      input: files.map((f) => f.filename).join(', '),
      output: JSON.stringify(result),
      credits_spent: 3,
    })
    .select('id')
    .single();
  if (insertErr || !gen) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }
  const spend = await spendCredits(org.org_id, 'interviews', gen.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', gen.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  return NextResponse.json({ ...result, generation_id: gen.id });
}
