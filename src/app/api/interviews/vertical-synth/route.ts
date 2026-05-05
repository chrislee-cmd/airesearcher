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

입력으로 인터뷰의 **모든 문항과 각 문항별 1차 요약**이 주어집니다. 당신의 임무는 다음과 같습니다:

# 단계 1 — 전체 조망 (절대 위에서부터 순서대로 작성하지 말 것)
- 먼저 모든 문항을 한 번에 훑어보고, 인터뷰 전체의 흐름·구조·논리를 파악합니다.
- 어떤 문항이 도입/맥락 제공이고, 어떤 문항이 핵심 탐구이며, 어떤 문항이 상세 후속/검증인지 식별합니다.
- 문항들 사이의 관계를 holistic하게 매핑합니다 (예: A에서 B로의 전환, A와 C의 대비, A→B→C의 인과).

# 단계 2 — 흐름을 반영한 요약 재구성
- 각 문항에 대해, 그 문항이 인터뷰 전체 흐름 안에서 차지하는 위치·역할을 반영한 풍부한(rich, wordy) 요약을 작성합니다.
- 1차 요약을 단순 정제·압축하지 말고, **앞뒤 문항과의 맥락**을 명시적으로 녹여서 재서술합니다.
- 예: "앞선 [도입 질문]에서 드러난 ...라는 배경 위에서, 이 문항은 ...에 대한 응답자들의 반응을 ...했다. 이는 뒤이은 [후속 질문]의 ...로 자연스럽게 연결된다."
- 응답자 간 공통점·차이점·갈등은 유지하되, 그것이 인터뷰의 어느 단계에서 어떤 의미를 갖는지를 드러냅니다.
- 분량은 정보 밀도에 비례해서 길어져도 좋습니다 (3~6문장 권장, 의미 있다면 더 길어도 OK). 충분한 정보가 담긴 wordy하고 rich한 단락을 지향하되, 빈말로 늘리지 마세요.

# 출력 규칙
- 출력 순서는 입력 순서와 정확히 일치 (인덱스 0부터).
- 입력 row 개수와 정확히 같은 개수의 summary 문자열을 반환.
- 정의된 JSON 스키마(summaries 배열)만 반환, 그 외 텍스트 금지.`;

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
      prompt: `총 ${rows.length}개 문항입니다. 단계 1(전체 조망) → 단계 2(흐름 반영 재구성) 순으로 작업한 뒤, 각 문항별 재구성된 요약을 입력 순서대로 반환해주세요.\n\n${blocks.join('\n\n')}`,
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
