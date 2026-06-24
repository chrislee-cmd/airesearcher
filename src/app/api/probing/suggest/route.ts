import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  PROBING_SYSTEM,
  probingSuggestionSchema,
} from '@/lib/probing-prompts';

// 위젯 trigger 는 60초 주기 — 단일 호출이 60초 안에 끝나야 다음 자동 호출이
// 겹치지 않는다. Sonnet 4.6 의 ~300 token 응답은 보통 5~10초 이내라 마진 충분.
export const maxDuration = 60;

const Body = z.object({
  // ~500-1500 토큰 정도가 정상. cap 은 60_000 자 — 화자 모두 길게 떠들어도
  // 안전한 상한. 30글자 미만은 client 가 이미 skip 하지만 서버도 한 번 더 차단.
  transcript_window: z.string().min(30).max(60_000),
  // PR-2 범위 밖. client 는 빈 문자열로 보냄. 후속 PR 에서 interview_jobs
  // template 를 묶을 자리.
  interview_guide: z.string().max(20_000).optional().default(''),
  max_questions: z.union([z.literal(3), z.literal(4), z.literal(5)]).default(4),
});

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
  const { transcript_window, interview_guide, max_questions } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  const guideBlock = interview_guide.trim().length > 0
    ? `\n\n[인터뷰 가이드 / RQ]\n${interview_guide}\n`
    : '';

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: probingSuggestionSchema,
    system: PROBING_SYSTEM,
    prompt: `다음은 라이브 인터뷰의 최근 ~90초 transcript 입니다. **${max_questions}개의 probing 질문**을 제안하세요. 응답자의 직전 발화에서 출발하세요.${guideBlock}

[transcript]
${transcript_window}`,
    // 0.4 — 같은 transcript 에서도 매 호출마다 약간 다른 각도가 제안되도록.
    // 0 에 두면 60초마다 거의 동일한 질문이 반복돼 위젯 가치가 떨어짐.
    temperature: 0.4,
    maxOutputTokens: 600,
  });

  return result.toTextStreamResponse();
}
