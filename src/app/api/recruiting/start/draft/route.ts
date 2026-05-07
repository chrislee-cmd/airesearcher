import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';
import { recruitingEmailDraftSchema } from '@/lib/recruiting-email-schema';

export const maxDuration = 60;

const Body = z.object({ brief: recruitingBriefSchema });

const SYSTEM = `당신은 정량 리서치 모집 코디네이터입니다. 추출된 모집 브리프(대상자 조건 + 일정 등)를 보고, 모집 안내 메일에 들어갈 6개 필드(purpose, target, method, schedule, location, incentive)를 짧고 명료하게 제안하세요.

규칙:
- 각 필드는 한 줄, 중복어 없이 핵심만.
- target: brief의 criteria를 사람 대상 한 줄로 요약 (예: "향후 3개월 이내에 제주도나 후쿠오카 여행 계획이 있는 사람").
- method 기본값: "1:1 온라인 인터뷰, 60분". brief에 다른 방식 명시되면 반영.
- schedule: brief에 일정이 있으면 그대로 반영, 없거나 모호하면 "추후 협의" 명시.
- location 기본값: "온라인 인터뷰".
- incentive 기본값: "현금 7만원" (brief에 명시 없을 때).
- 모든 필드는 한국어.
- 정의된 JSON 스키마만 출력.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: recruitingEmailDraftSchema,
      system: SYSTEM,
      prompt: `다음 모집 브리프를 토대로 메일 필드를 채워주세요.\n\n${JSON.stringify(parsed.data.brief, null, 2)}`,
      temperature: 0.2,
    });
    return NextResponse.json({ draft: object });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'draft_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
