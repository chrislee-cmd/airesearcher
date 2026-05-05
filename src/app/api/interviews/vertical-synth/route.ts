import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300;

// Input: every row's question + its horizontal (per-row) summary. The
// model must read the *entire* list at once before writing anything,
// because the value of this pass is interpreting how each question fits
// into the larger interview arc — earlier questions set context, later
// ones drill into specifics, and the rewritten summary should reflect
// that holistic understanding.
const Body = z.object({
  rows: z
    .array(
      z.object({
        question: z.string(),
        summary: z.string(),
      }),
    )
    .min(1)
    .max(200),
});

// Output is now a *consolidated* insight list — multiple input questions
// can be fused into one insight row, so insights.length is typically <
// rows.length. Each insight references its source question indices so the
// UI can show provenance / link back to the response matrix.
const responseSchema = z.object({
  insights: z.array(
    z.object({
      topic: z.string(),
      summary: z.string(),
      sourceIndices: z.array(z.number().int()),
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
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { rows } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key' }, { status: 500 });
  }

  const blocks = rows.map((row, idx) => {
    return `[${idx}] 문항: ${row.question}\n초기 요약: ${row.summary || '(요약 없음)'}`;
  });

  const SYSTEM = `당신은 인터뷰 분석 도우미입니다.

입력으로 인터뷰의 **모든 문항과 각 문항별 1차 요약**이 인덱스와 함께 주어집니다. 당신의 임무는 1:1 재서술이 아니라, 관련된 문항들을 **융합**하여 새로운 인사이트로 재구성하는 것입니다.

# 단계 1 — 전체 조망
모든 문항을 한 번에 훑고, 어떤 문항들이 의미상 같은 주제를 다루는지 그룹핑합니다. 비슷한 영역을 탐색하는 문항(예: 등급 산정 기준, 장기 고객 혜택, 멤버십 개선 요구)들은 한 묶음으로 봐야 합니다.

# 단계 2 — 융합 인사이트 작성
각 그룹에 대해 하나의 통합 인사이트 row를 만듭니다.
- **topic**: 그 그룹이 다루는 핵심 주제를 한 줄로 (질문 형식 가능, 예: "등급 산정 기준과 장기 고객 혜택에 대한 인식")
- **summary**: 그 그룹에 속한 문항들의 데이터를 융합 분석한 인사이트 본문. 단일 문항만 다루는 그룹이라도, 그 인사이트가 본질적이면 단독 row로 둬도 됩니다.
- **sourceIndices**: 이 인사이트가 합성한 원본 문항들의 인덱스 배열 (반드시 입력 인덱스 그대로).

# 절대 하지 말 것 (매우 중요)
- ❌ "이 문항은 ~를 탐색하는 문항이다", "~에 대한 평소 인식을 묻는 문항이다" 같이 **문항의 취지·목적을 설명하는 메타 서술**. 이건 분석이 아니라 filler입니다.
- ❌ "문항 8과 연결된다", "이후 문항 41, 42의 ~로 이어진다" 같이 **다른 문항을 인덱스로 참조**하는 문장. 참조하지 말고, 그 문항의 데이터를 이미 본 summary에 **직접 융합**하세요.
- ❌ 입력 1차 요약을 그대로 옮기거나 단순 압축. 반드시 그룹 내 다른 문항들의 응답과 교차해서 새로운 통찰을 도출.

# 작성 원칙
- 응답자들의 발화에서 드러나는 패턴, 모순, 강도, 그리고 그 이면의 욕구·불만을 직접 서술합니다.
- 응답자 간 공통점·차이점·갈등이 인사이트의 핵심이라면 그것을 명시적으로 보여주세요.
- 분량은 정보 밀도에 비례 — 융합된 그룹일수록 풍부한 단락(5~10문장 이상도 가능). 단일 문항 그룹은 짧을 수 있음. 빈말로 늘리지 마세요.

# 출력 규칙
- 모든 입력 인덱스는 정확히 한 번씩만 sourceIndices에 등장 (누락 금지, 중복 금지).
- insights 배열의 순서는 인터뷰 흐름을 반영해서 자연스럽게 (앞쪽 인덱스를 다루는 그룹이 대체로 앞쪽).
- 정의된 JSON 스키마(insights)만 반환, 그 외 텍스트 금지.`;

  // Stream the response. The point isn't to render partials on the client
  // (we only render once the array is complete) — it's to keep the HTTP
  // connection sending bytes so the gateway proxy doesn't 504 while
  // Sonnet is still composing 30+ wordy summaries.
  try {
    const anthropic = createAnthropic({ apiKey });
    const result = streamObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: responseSchema,
      system: SYSTEM,
      prompt: `총 ${rows.length}개 문항입니다. 단계 1(주제 그룹핑) → 단계 2(융합 인사이트 작성) 순으로 작업해주세요. 결과 row 개수는 입력보다 줄어들어도 좋습니다 — 의미적으로 묶이는 문항은 반드시 묶어서 하나의 인사이트로 통합하세요.\n\n${blocks.join('\n\n')}`,
      temperature: 0.3,
    });
    return result.toTextStreamResponse();
  } catch (e) {
    console.warn('[vertical-synth] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'vertical_synth_failed' },
      { status: 500 },
    );
  }
}
