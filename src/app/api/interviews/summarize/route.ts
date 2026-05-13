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

// Each per-row summary is now split into a mainstream tendency and any
// minority/outlier cases. The split is required so the result page can
// surface 대표 경향성 / 소수 케이스 distinctly — never collapsed back
// into one blob.
const responseSchema = z.object({
  summaries: z.array(
    z.object({
      mainstream: z.string(),
      outliers: z
        .array(
          z.object({
            description: z.string(),
            filenames: z.array(z.string()),
          }),
        )
        .default([]),
    }),
  ),
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

각 문항(row)에 대해, 모든 응답자들의 발화를 종합해서 MECE(Mutually Exclusive, Collectively Exhaustive)하게 요약합니다. 단, **다수가 공유하는 대표 경향성**과 **소수만 가지는 소수 케이스**를 명확히 분리해서 정리합니다.

# 출력 구조
각 문항의 summary는 두 부분으로 구성됩니다.

## mainstream (대표 경향성)
- 다수 응답자가 공통적으로 보여주는 패턴·태도·니즈를 종합한 2~5문장 단락.
- 응답자 절반 이상이 공유하거나, 응답자 수와 무관하게 인터뷰의 중심 신호라고 판단되는 흐름을 담습니다.
- 누구의 발화를 그대로 인용하지 말고, 종합·재구성해서 서술합니다.

## outliers (소수 케이스 배열)
- 대표 경향성에서 벗어나는 모순·예외·극단·갈등 응답을 **별도 항목**으로 분리합니다.
- 각 항목은:
  - description: 어떤 결로 다른지 한두 문장으로 서술 (예: "타사 이탈 경험을 근거로 등급제 자체에 회의적인 의견")
  - filenames: 그 결을 보인 응답자의 파일명 배열 (없으면 빈 배열, 가능한 한 채워주세요)
- 모두가 거의 비슷하게 답한 문항이면 outliers는 빈 배열로 둡니다 — 억지로 만들지 마세요.
- 소수 케이스가 여러 결로 나뉘면(예: 두 명은 A 방향, 한 명은 B 방향) 항목을 나눠서 적습니다.

# 규칙
- 출력 순서는 입력 순서와 정확히 일치해야 하며, 입력 row 개수와 정확히 같은 개수의 summary 객체를 반환합니다.
- filenames에 적는 이름은 반드시 입력에 등장한 (filename) 그대로 사용 — 변형 금지.
- 응답이 없거나 불충분한 경우 mainstream에 "충분한 응답이 수집되지 않음" 등으로 간결히 표시하고 outliers는 빈 배열.
- 출력은 정의된 JSON 스키마(summaries 배열)만, 그 외 텍스트 금지.`;

  try {
    const anthropic = createAnthropic({ apiKey });
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: responseSchema,
      system: SYSTEM,
      prompt: `총 ${rows.length}개 문항입니다. 각각에 대해 모든 응답자 발화를 종합해서, mainstream(대표 경향성)과 outliers(소수 케이스)로 분리해 요약해주세요.\n\n${blocks.join('\n\n')}`,
      temperature: 0.2,
    });
    let summaries = result.object.summaries;
    // Defensive: pad/truncate to match row count exactly so the UI can map
    // 1:1 by index without bounds checks.
    if (summaries.length < rows.length) {
      summaries = [
        ...summaries,
        ...Array(rows.length - summaries.length).fill({
          mainstream: '',
          outliers: [],
        }),
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
