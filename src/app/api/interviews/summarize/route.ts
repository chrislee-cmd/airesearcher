import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300;

const Body = z.object({
  rows: z
    .array(
      z.object({
        question: z.string(),
        cells: z.array(
          z.object({
            filename: z.string(),
            voc: z.string(),
          }),
        ),
      }),
    )
    .min(1)
    .max(800),
});

const responseSchema = z.object({
  summaries: z.array(z.string()),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    console.warn(
      '[summarize] invalid_input:',
      parsed.error.issues.slice(0, 5),
    );
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const { rows } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key' }, { status: 500 });
  }

  // Build a compact prompt — one block per row with the question and every
  // respondent's verbatim. Empty cells are skipped so the model isn't asked
  // to summarize silence.
  const blocks = rows.map((row, idx) => {
    const lines = row.cells
      .filter((c) => c.voc && c.voc.trim().length > 0)
      .map((c) => `- (${c.filename}) ${c.voc.trim()}`);
    const body = lines.length > 0 ? lines.join('\n') : '(응답 없음)';
    return `[${idx}] 문항: ${row.question}\n응답:\n${body}`;
  });

  const SYSTEM = `당신은 인터뷰 응답 요약 도우미입니다.

각 문항(row)에 대해, 모든 응답자들의 발화를 종합해서 MECE(Mutually Exclusive, Collectively Exhaustive)하게 요약합니다.

# 규칙
- 각 문항당 한 단락(2~5문장 권장)으로, 응답자 전체에 걸친 핵심 패턴/공통점/차이점을 정리합니다.
- 중복되는 의견은 묶고, 상충되는 의견은 명시적으로 구분합니다 (예: "...라고 한 응답자도 있고, 반대로 ...라고 한 응답자도 있다").
- 특정 응답자의 발화를 그대로 인용하지 말고, 종합·재구성해서 서술합니다.
- 응답이 없거나 불충분한 경우 "충분한 응답이 수집되지 않음" 등으로 간결히 표시합니다.
- 출력 순서는 입력 순서와 정확히 일치해야 하며, 입력 row 개수와 정확히 같은 개수의 summary 문자열을 반환합니다.
- 출력은 정의된 JSON 스키마(summaries 배열)만, 그 외 텍스트 금지.`;

  try {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: responseSchema,
      system: SYSTEM,
      prompt: `총 ${rows.length}개 문항입니다. 각각에 대해 모든 응답자 발화를 종합 요약해주세요.\n\n${blocks.join('\n\n')}`,
      temperature: 0.2,
    });
    let summaries = result.object.summaries;
    // Defensive: pad/truncate to match row count exactly so the UI can map
    // 1:1 by index without bounds checks.
    if (summaries.length < rows.length) {
      summaries = [
        ...summaries,
        ...Array(rows.length - summaries.length).fill(''),
      ];
    } else if (summaries.length > rows.length) {
      summaries = summaries.slice(0, rows.length);
    }
    return NextResponse.json({ summaries });
  } catch (e) {
    console.warn('[summarize] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'summarize_failed' },
      { status: 500 },
    );
  }
}
