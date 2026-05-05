import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { slideOutlineSchema } from '@/lib/reports-slides-schema';

export const maxDuration = 800;

const Body = z.object({
  markdown: z.string().min(1).max(200_000),
});

const SYSTEM = `당신은 시니어 리서치 발표자입니다. 1차 정리된 표준 양식 Markdown 보고서를 받아, **발표용 슬라이드 outline**을 JSON 스키마로 작성합니다.

**핵심 원칙: 한 슬라이드 = 한 메시지**
- 두꺼운 텍스트 슬라이드 금지. 청중이 5초 안에 핵심을 잡을 수 있어야 함.
- 한 챕터를 단일 슬라이드에 욱여넣지 말 것 — 발견점/인용/정량/시사점을 각각 다른 kind의 슬라이드로 분할.
- 표지 → 메소돌로지 → Executive KPI → 챕터별(divider → findings → quote → quant → implication) → 권장 액션 → 클로징 흐름.

**slide kind 활용 가이드**
- \`cover\`: 표지 1장. 제목 + 부제 + meta 4 stat (METHOD/SAMPLE/PERIOD/CHAPTERS).
- \`section_divider\`: 챕터 진입 슬라이드. 큰 eyebrow ("CHAPTER 02") + 챕터 제목 + 한 줄 부제. 텍스트 최소.
- \`kpi_grid\`: Executive Summary나 Methodology처럼 4개 미만의 큰 숫자/카테고리. 각 item의 \`value\`는 짧게(예: "n=252", "5 themes").
- \`insight_cards\`: Executive Summary에 적합. 2~4개의 헤드라인+짧은 본문 카드.
- \`theme_split\`: 챕터의 메인 발견 슬라이드. findings bullets + 우측 verbatim 1개 + 하단 implication 한 줄.
- \`quote_card\`: 강한 단일 인용을 슬라이드 전체로 띄움. 제목은 그 인용이 답하는 질문 톤.
- \`bar_chart\`: 정량 데이터가 있을 때만. 2~8개 시리즈. value는 숫자(소수점 OK), valueSuffix에 단위.
- \`table\`: 비교가 표가 더 명확할 때. 2~5열, 1~8행.
- \`recommendations\`: 마지막 액션 목록 1~2장.
- \`closing\`: 마무리 슬라이드 (Q&A / Thank you).

**규칙**
- 스키마의 optional 필드는 정보가 없으면 **필드 자체를 생략**하세요. \`null\`로 채우지 말 것.
- 입력 markdown에 명시적으로 없는 사실/숫자/인용을 만들지 말 것.
- bar_chart의 series.value는 입력에 명시된 숫자만. 추정 금지.
- 권장 슬라이드 수: 12~25장. 발표 길이 30~45분 기준.
- 모든 텍스트는 한국어.
- eyebrow는 모두 UPPERCASE 영문 또는 한글 짧은 라벨 (예: "CHAPTER 03", "EXECUTIVE SUMMARY", "방법론").

JSON 스키마 외 출력 금지.`;

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
  const { markdown } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: slideOutlineSchema,
      system: SYSTEM,
      prompt: `다음은 1차 정리된 표준 양식 Markdown 보고서입니다. 위 가이드에 따라 slide outline JSON을 작성하세요.\n\n${markdown}`,
      temperature: 0.3,
      maxOutputTokens: 16000,
    });
    return NextResponse.json({ outline: result.object });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'slides_failed';
    console.error('[reports/slides] error', e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
