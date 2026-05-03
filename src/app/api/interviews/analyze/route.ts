import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const maxDuration = 300;

const Body = z.object({
  extractions: z
    .array(
      z.object({
        filename: z.string().min(1),
        items: z.array(
          z.object({
            question: z.string(),
            voc: z.string(),
          }),
        ),
      }),
    )
    .min(1)
    .max(20),
});

// LLM only deduplicates questions and maps each file's items to the
// standard question list. The matrix itself is built deterministically
// on the server below — eliminating the empty-cell failure mode where
// Sonnet would emit cells: [] for every row.
const aggregateSchema = z.object({
  questions: z.array(z.string()),
  /**
   * mappings[fileIdx] is an array of length === questions.length.
   * Each entry is the index into extractions[fileIdx].items that answers
   * the standard question at that position, or -1 if no item matches.
   */
  mappings: z.array(z.array(z.number().int())),
});

const SYSTEM = `당신은 마케팅·UX 리서치 분석가입니다. 이미 파일별로 추출된 (질문 / VOC) 항목들을 받아 두 가지를 결정합니다:

1) **표준 문항 목록 (questions)** — 모든 파일의 질문 합집합에서 의미가 거의 동일한 것은 하나로 묶어 표준화한 목록. 한 파일에서만 나온 질문도 포함. 인터뷰 진행 순서를 최대한 따른다. 보통 10~40개.

2) **mappings** — 입력 파일마다 길이가 questions.length 와 정확히 같은 정수 배열. 위치 i의 값은 그 파일의 items 중 questions[i] 에 해당하는 항목의 인덱스 (0부터). 매칭되는 항목이 없으면 -1.

# 출력 규칙
- mappings.length === 입력 파일 수
- 각 mappings[fileIdx].length === questions.length
- 인덱스 값은 -1 또는 0..(items.length-1) 범위 정수
- 정의된 JSON 스키마 외 텍스트 금지`;

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

  const fileListBlock = `# Files (${filenames.length})\n${filenames
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n')}`;

  const dataBlock = extractions
    .map((e, fi) => {
      const lines = e.items
        .map(
          (it, ii) =>
            `  [${ii}] Q: ${it.question}\n      VOC: ${it.voc}`,
        )
        .join('\n');
      return `## File ${fi + 1}: ${e.filename}\n${lines}`;
    })
    .join('\n\n---\n\n');

  const userPrompt = `${fileListBlock}\n\n# Items per file (0-indexed)\n\n${dataBlock}`;

  let aggregate: z.infer<typeof aggregateSchema>;
  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: aggregateSchema,
      system: SYSTEM,
      prompt: userPrompt,
      temperature: 0.1,
    });
    aggregate = result.object;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'analyze_failed' },
      { status: 502 },
    );
  }

  // Defensive: pad / clamp mappings to the expected shape
  const Q = aggregate.questions.length;
  const safeMappings: number[][] = filenames.map((_, fi) => {
    const row = aggregate.mappings[fi] ?? [];
    const padded = row.slice(0, Q);
    while (padded.length < Q) padded.push(-1);
    return padded;
  });

  // Build the matrix on the server from the input extractions + index map.
  const matrix = {
    questions: aggregate.questions,
    rows: aggregate.questions.map((question, qIdx) => ({
      question,
      cells: extractions.map((ext, fileIdx) => {
        const itemIdx = safeMappings[fileIdx]?.[qIdx] ?? -1;
        if (itemIdx < 0 || itemIdx >= ext.items.length) {
          return { filename: ext.filename, voc: '' };
        }
        return { filename: ext.filename, voc: ext.items[itemIdx].voc };
      }),
    })),
  };

  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'interviews',
      input: filenames.join(', '),
      output: JSON.stringify(matrix),
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

  return NextResponse.json(matrix);
}
