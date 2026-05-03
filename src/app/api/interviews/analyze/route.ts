import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { interviewMatrixSchema } from '@/lib/interview-schema';

export const maxDuration = 300;

const Body = z.object({
  extractions: z
    .array(
      z.object({
        filename: z.string().min(1),
        items: z.array(
          z.object({
            question: z.string(),
            summary: z.string(),
            verbatim: z.string(),
          }),
        ),
      }),
    )
    .min(1)
    .max(20),
});

const SYSTEM = `당신은 마케팅·UX 리서치 분석가입니다. 이미 파일별로 추출된 (질문 / 요약 / verbatim) 데이터를 받아 다음을 수행하세요:

1) **표준 문항 만들기**
   - 모든 파일에 등장한 질문들의 합집합을 만든 뒤, 표현만 다른 동일 의도의 질문은 하나의 표준 문항으로 통합하세요.
   - 한 파일에서만 나온 질문도 포함합니다.
   - 인터뷰 진행 순서를 최대한 유지하세요.

2) **셀 채우기**
   - 각 표준 문항에 대해 입력된 모든 파일을 순회하면서, 그 파일의 항목 중 표준 문항과 매칭되는 것을 찾아 \`summary\` 와 \`voc\`를 그대로 옮기세요.
     - "voc" 필드에는 입력의 \`verbatim\` 문자열을 **글자 그대로** 옮기세요. 변경·번역·요약 금지.
     - 매칭되는 항목이 없으면 summary와 voc 모두 빈 문자열.
   - 같은 파일에 매칭 후보가 여러 개라면 가장 직접적으로 답한 항목 하나를 선택.

3) 한국어로 작성. 출력은 정의된 JSON 스키마만, 그 외 텍스트 금지.`;

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
  const { extractions } = parsed.data;

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('credit_balance')
    .eq('id', org.org_id)
    .single();
  if (!orgRow || (orgRow.credit_balance ?? 0) < 3) {
    return NextResponse.json({ error: 'insufficient' }, { status: 402 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const userPrompt = extractions
    .map((e, idx) => {
      const lines = e.items
        .map(
          (it, i) =>
            `  ${i + 1}. Q: ${it.question}\n     summary: ${it.summary}\n     verbatim: ${it.verbatim}`,
        )
        .join('\n');
      return `## File ${idx + 1}: ${e.filename}\n${lines}`;
    })
    .join('\n\n---\n\n');

  const filenames = extractions.map((e) => e.filename);

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: interviewMatrixSchema,
    system: SYSTEM,
    prompt: userPrompt,
    temperature: 0.1,
    onFinish: async ({ object }) => {
      if (!object) return;
      const supa = await createClient();
      const { data: gen } = await supa
        .from('generations')
        .insert({
          org_id: org.org_id,
          user_id: user.id,
          feature: 'interviews',
          input: filenames.join(', '),
          output: JSON.stringify(object),
          credits_spent: 3,
        })
        .select('id')
        .single();
      if (gen) {
        const spend = await spendCredits(org.org_id, 'interviews', gen.id);
        if (!spend.ok) {
          await supa.from('generations').delete().eq('id', gen.id);
        }
      }
    },
  });

  return result.toTextStreamResponse();
}
