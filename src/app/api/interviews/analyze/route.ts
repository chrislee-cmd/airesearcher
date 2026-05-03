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

const SYSTEM = `당신은 마케팅·UX 리서치 분석가입니다. 이미 파일별로 추출된 (질문 / 요약 / verbatim) 데이터를 받아 행렬을 채우세요.

# 입력
사용자 메시지 상단에 \`# FILES (N개)\` 섹션이 나오고, 그 뒤에 각 파일별 추출 데이터가 옵니다.

# 출력 — JSON 스키마를 정확히 따르세요
{
  "questions": [string],     // 표준 문항 목록, 인터뷰 진행 순서대로
  "rows": [
    {
      "question": string,    // questions[] 의 한 항목
      "cells": [             // *반드시* 입력 파일 개수(N)와 같은 길이
        { "filename": string, "summary": string, "voc": string }
      ]
    }
  ]
}

# 절대 규칙 — 어떤 경우에도 어기지 말 것
1. **\`rows\`는 비울 수 없다.** \`questions\`에 들어간 모든 표준 문항은 \`rows\`에도 같은 순서로 등장해야 한다.
2. **각 \`row.cells\`의 길이는 입력 파일 개수와 정확히 같다.** 파일 리스트의 모든 filename에 대해 cell이 하나씩 존재해야 하며, 순서도 입력 파일 순서를 따른다.
3. **\`cell.filename\`은 입력 파일 리스트의 정확한 문자열 중 하나여야 한다.** 임의 변형 금지.
4. **\`cell.summary\` / \`cell.voc\`는 입력 데이터의 해당 항목에서 글자 그대로 복사한다.** 번역·요약·재작성 금지. (입력의 \`summary\`는 이미 응답자 원문에서 정제·발췌된 텍스트이며, 그 자체로 그대로 옮긴다.)
5. **매칭되는 항목이 없는 cell은 빈 문자열 두 개**(\`summary: ""\`, \`voc: ""\`)이지만, **filename은 비울 수 없다** — 매칭 없어도 cell은 반드시 존재해야 한다.

# 절차
1) 각 파일의 모든 질문을 모은 뒤, 의미가 거의 동일한 질문은 하나의 표준 문항으로 묶는다.
2) 표준 문항 목록을 \`questions\`에 인터뷰 흐름 순서대로 채운다.
3) 표준 문항마다 \`row\`를 만들고, 입력 파일 리스트 순서대로 모든 파일의 cell을 채운다.

한국어로 작성. JSON 외 텍스트 금지.`;

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

  const filenames = extractions.map((e) => e.filename);

  const fileListBlock = `# FILES (${filenames.length}개) — 각 row.cells 는 정확히 이 ${filenames.length}개 항목을 이 순서대로 포함해야 합니다\n${filenames
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n')}`;

  const dataBlock = extractions
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

  const userPrompt = `${fileListBlock}\n\n# DATA\n\n${dataBlock}`;

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
