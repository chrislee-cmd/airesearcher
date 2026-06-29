// probing-reflection — 좌패널 Persona Agent.
//
// PR (probing-persona-panels): 기존 3 섹션 reflection 을 페르소나 8 패널로
// 재편. transcript 누적 + (옵션) 가이드를 받아 8 섹션 (demographics /
// values / preferences / needs / painpoints / brand_perception /
// decision_drivers / behavioral_patterns) 각각의 summary + signals +
// confidence 를 반환한다. 영속화 X — 위젯 in-memory only.
//
// 엔드포인트 path 는 그대로 (`/api/probing/reflection`) — 위젯 코드 한
// 곳에서만 호출하므로 break 영향 없음. 응답 schema 가 바뀌었기에 다른
// 호출자가 있으면 동시에 갱신 필요 (현재 없음 — 확인됨 grep 0).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  PROBING_PERSONA_SYSTEM,
  probingPersonaSchema,
} from '@/lib/probing-prompts';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 60;

const Body = z.object({
  // 누적 transcript — 좌패널은 직전 30초가 아닌 누적 발화를 보고 응답자
  // 전체 그림을 그린다. cap 은 suggest 와 동일 60_000 자.
  transcript_window: z.string().min(30).max(60_000),
  interview_guide: z.string().max(20_000).optional().default(''),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { transcript_window, interview_guide } = parsed.data;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  const guideText = interview_guide.trim();
  const hasGuide = guideText.length > 0;
  const sanitizeCtx = {
    endpoint: '/api/probing/reflection',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
  };
  const transcriptSan = await sanitizeUserInput(transcript_window, 'transcript', {
    ...sanitizeCtx,
    input_length: transcript_window.length,
    input_label: 'transcript',
  });
  const guideSan = hasGuide
    ? await sanitizeUserInput(guideText, 'interview_guide', {
        ...sanitizeCtx,
        input_length: guideText.length,
        input_label: 'interview_guide',
      })
    : null;
  const guideBlock = guideSan
    ? `## 사용자가 제공한 가이드 (인터뷰 RQ / 가설 / 의도)\n${guideSan.wrapped}\n\n위 가이드의 가설 / 의도 검증 흐름이 응답자 이해의 1순위 방향입니다.\n\n`
    : '';

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: probingPersonaSchema,
    system: PROBING_PERSONA_SYSTEM,
    prompt: `${guideBlock}## Transcript (누적)
${transcriptSan.wrapped}

---
위 transcript 만 보고 응답자의 페르소나를 8 섹션 (demographics / values / preferences / needs / painpoints / brand_perception / decision_drivers / behavioral_patterns) 으로 채우세요. transcript 가 빈약한 섹션은 confidence='insufficient' + summary 빈 문자열 + signals 빈 배열로 두세요. 일반론으로 빈 칸을 채우지 마세요.`,
    // 0.3 — 같은 transcript 에서 호출마다 큰 흔들림 없도록. 0 은 너무
    // 동일한 문장을 반복, 0.4 (suggest) 보다는 보수적.
    temperature: 0.3,
    // 8 섹션 × (summary + signals + confidence) — 풀 응답 ~2500~3500 token.
    // 4000 으로 상향해 cap 충돌 회피.
    maxOutputTokens: 4000,
    providerOptions: ZERO_RETENTION,
  });

  return result.toTextStreamResponse({
    headers: {
      'x-probing-guide-length': String(guideText.length),
      'x-probing-window-chars': String(transcript_window.length),
    },
  });
}
