import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';
import { recruitingEmailDraftSchema } from '@/lib/recruiting-email-schema';
import { ISOLATION_NOTICE, sanitizeUserInput } from '@/lib/llm/sanitize';
import {
  outputLangLabel,
  resolveOutputLang,
} from '@/lib/i18n/output-language';
import { readRequestLocale } from '@/lib/i18n/request-locale';

export const maxDuration = 60;

const Body = z.object({ brief: recruitingBriefSchema });

// 모집 안내 메일 초안 — 수신자(모집 대상)에게 발송되는 유저-facing 이메일이라
// 작성자(리서처)의 로케일 언어로 필드를 채운다(i18n Phase 7). 예시/기본값은
// 한국어로 두되 "출력은 ${label}" 지시가 우선이라 모델이 해당 언어로 로케일화한다.
function buildDraftSystem(lang: string): string {
  const label = outputLangLabel(resolveOutputLang(undefined, lang));
  return `당신은 정량 리서치 모집 코디네이터입니다. 추출된 모집 브리프(대상자 조건 + 일정 등)를 보고, 모집 안내 메일에 들어갈 6개 필드(purpose, target, method, schedule, location, incentive)를 짧고 명료하게 제안하세요.

규칙:
- 각 필드는 한 줄, 중복어 없이 핵심만.
- target: brief의 criteria를 사람 대상 한 줄로 요약 (예: "향후 3개월 이내에 제주도나 후쿠오카 여행 계획이 있는 사람").
- method 기본값: "1:1 온라인 인터뷰, 60분" 상당. brief에 다른 방식 명시되면 반영.
- schedule: brief에 일정이 있으면 그대로 반영, 없거나 모호하면 "추후 협의" 상당으로 명시.
- location 기본값: "온라인 인터뷰" 상당.
- incentive 기본값: 사례비(brief에 명시 없으면 적정 사례 한 줄).
- **모든 필드는 ${label}(으)로 작성** — 수신 대상이 읽을 언어입니다.
- 정의된 JSON 스키마만 출력.${ISOLATION_NOTICE}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  // 발송 맥락 로케일 = 작성자(리서처) UI 로케일(NEXT_LOCALE) > en.
  const draftSystem = buildDraftSystem(await readRequestLocale());

  const briefJson = JSON.stringify(parsed.data.brief, null, 2);
  const briefSan = await sanitizeUserInput(briefJson, 'recruiting_brief', {
    endpoint: '/api/recruiting/start/draft',
    user_id: user.id,
    org_id: null,
    actor_email: user.email ?? null,
    input_length: briefJson.length,
    input_label: 'recruiting_brief',
  });
  try {
    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: recruitingEmailDraftSchema,
      system: draftSystem,
      prompt: `다음 모집 브리프를 토대로 메일 필드를 채워주세요.\n\n${briefSan.wrapped}`,
      temperature: 0.2,
      providerOptions: ZERO_RETENTION,
    });
    return NextResponse.json({ draft: object });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'draft_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
