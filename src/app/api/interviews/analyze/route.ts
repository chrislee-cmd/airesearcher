import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { interviewMatrixSchema } from '@/lib/interview-schema';

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

1) **질문 추출** — 입력된 모든 인터뷰에서 진행자(Moderator/M/진행자/면접관)가 던진 모든 질문을 빠짐없이 수집하세요.
   - 단 한 인터뷰에서만 나온 질문도 포함합니다. "공통이 아니어도" 모두 포함.
   - 의미가 거의 동일한 질문(표현만 다른 같은 의도)은 하나의 표준 문항으로 묶으세요.
   - 너무 사소한 후속 확인성 질문("그래요?", "맞나요?")은 제외합니다.
   - 일반적으로 결과는 10~40개 사이의 표준 문항이 됩니다. 1~2개로 줄이지 마세요.
   - 문항 순서는 인터뷰 진행 순서를 최대한 따릅니다.

2) **답변 정리** — 각 표준 문항에 대해, 입력된 파일별로:
   - "summary" — 응답자의 답을 1~2문장으로 사실 위주 요약. 평가·해석 금지.
   - "voc" — 응답자가 실제로 한 말을 그대로 옮긴 한 줄 인용구 (Voice of Customer). 큰따옴표는 포함하지 마세요.
   - 한 응답자가 그 문항에 답하지 않았으면 summary와 voc 모두 빈 문자열.

3) 출력은 정의된 JSON 스키마를 정확히 따르고, 그 외 텍스트는 포함하지 마세요. 한국어로 작성하세요.`;

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

  // Pre-check credit balance so we don't burn tokens for an insolvent caller.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('credit_balance')
    .eq('id', org.org_id)
    .single();
  if (!orgRow || (orgRow.credit_balance ?? 0) < 3) {
    return NextResponse.json({ error: 'insufficient' }, { status: 402 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });

  // Allocate ~120k chars total so we stay under gpt-4o-mini's 128k context.
  const perFileBudget = Math.min(50000, Math.floor(120000 / files.length));
  const userPrompt = files
    .map(
      (f, idx) =>
        `## File ${idx + 1}: ${f.filename}\n\n${f.markdown.slice(0, perFileBudget)}`,
    )
    .join('\n\n---\n\n');

  const openai = createOpenAI({ apiKey });
  const filenames = files.map((f) => f.filename);

  const result = streamObject({
    model: openai('gpt-4o-mini'),
    schema: interviewMatrixSchema,
    system: SYSTEM,
    prompt: userPrompt,
    temperature: 0.2,
    onFinish: async ({ object }) => {
      // Stream is done — persist final object and atomically spend credit.
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
          // race / drained between pre-check and finish — undo the gen row
          await supa.from('generations').delete().eq('id', gen.id);
        }
      }
    },
  });

  return result.toTextStreamResponse();
}
