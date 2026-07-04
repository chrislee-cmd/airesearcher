// probing-backfill — 새 커스텀 조사 위젯이 생성될 때, 이미 누적된 대화에서
// 그 위젯에 담을 내용을 한 번(one-shot) 재분석해 자동으로 채우는 엔드포인트.
//
// 배경: 프로빙 파이프라인은 전부 stateless — transcript 는 client 가 보유하고
// body 로 넘긴다 (reflection / think / suggest 와 동일). 서버에 세션별 transcript
// store 가 없으므로 spec 의 `/sessions/[id]/backfill` (server-side loadSessionTranscript)
// 대신, 기존 flat 컨벤션 (`/api/probing/{suggest,reflection,think}`) 을 따라
// transcript 를 body 로 받는다.
//
// reflection 라우트가 이미 커스텀 섹션을 누적 transcript 로 채우지만, 그것은
// 다음 주기 tick 에서야 일어난다. 이 엔드포인트는 위젯 생성 **즉시** 그 한
// 섹션만 집중 재분석해 (a) 채울 내용이 있으면 바로 반환하고 (b) 없으면
// backfilled=false 로 알려 client 가 우선 질문 flag 를 켜게 한다.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { PROBING_OUTPUT_LANGS } from '@/lib/probing-prompts';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 60;

const Body = z.object({
  // 누적 transcript — reflection 과 동일 cap. 30자 미만은 client 가 이미 skip.
  transcript_window: z.string().min(30).max(60_000),
  // backfill 대상 커스텀 위젯 1개 (title 필수 + 조사 의도 description).
  section: z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(1000).optional().default(''),
  }),
  output_lang: z.enum(PROBING_OUTPUT_LANGS).optional(),
});

// LLM 응답 — reflection 의 persona section 과 같은 shape (summary + signals) 로
// 두어 client 가 그대로 reflection state 에 병합할 수 있게 한다. confidence 는
// 0~1 숫자로 받아 client 가 매치 여부 (>=0.5) 판정 + 라벨 변환.
const ResultSchema = z.object({
  matched: z.boolean(),
  summary: z.string(),
  signals: z
    .array(
      z.object({
        bullet: z.string(),
        quote: z.string().optional(),
      }),
    )
    .max(5),
  confidence: z.number().min(0).max(1),
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

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { transcript_window, section, output_lang } = parsed.data;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  const title = section.title.trim();
  const description = section.description.trim();
  const sanitizeCtx = {
    endpoint: '/api/probing/backfill',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
  };
  const transcriptSan = await sanitizeUserInput(transcript_window, 'transcript', {
    ...sanitizeCtx,
    input_length: transcript_window.length,
    input_label: 'transcript',
  });
  const titleSan = await sanitizeUserInput(title, 'widget_title', {
    ...sanitizeCtx,
    input_length: title.length,
    input_label: 'widget_title',
  });
  const descSan = description
    ? await sanitizeUserInput(description, 'widget_description', {
        ...sanitizeCtx,
        input_length: description.length,
        input_label: 'widget_description',
      })
    : null;

  const LANG_LABELS: Record<(typeof PROBING_OUTPUT_LANGS)[number], string> = {
    ko: '한국어',
    en: '영어(English)',
    ja: '일본어(日本語)',
    zh: '중국어(中文)',
    es: '스페인어(Español)',
    th: '태국어(ไทย)',
  };
  const langLabel = output_lang ? LANG_LABELS[output_lang] : null;
  const langRule = langLabel
    ? `**반드시 ${langLabel} 로 응답하세요.** transcript 의 언어와 무관하게 summary / signals 를 ${langLabel} 로 작성합니다.`
    : 'transcript 의 주 언어로 응답하세요.';

  const widgetBlock = descSan
    ? `## 채울 조사 위젯\n제목: ${titleSan.wrapped}\n조사 의도: ${descSan.wrapped}`
    : `## 채울 조사 위젯\n제목: ${titleSan.wrapped}`;

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: ResultSchema,
      system: `당신은 인터뷰 분석가입니다. 사용자가 방금 새로운 조사 위젯을 추가했습니다. 이미 진행된 대화(transcript) 안에 이 위젯에 담을 만한 내용이 **이미 언급됐는지** 판정하고, 있으면 추출하세요.

- **응답자 발화에만 기반** — transcript 에 실제로 있는 내용만. 없는 사실을 지어내지 마세요.
- 관련 내용이 실제로 있으면 matched=true, summary(1~2문장) + signals(관찰 신호, 가능한 한 transcript 인용 quote 포함, 최대 5개) 를 채우고 confidence 를 0.5 이상으로.
- 관련 내용이 **없거나 빈약** 하면 matched=false, summary 빈 문자열, signals 빈 배열, confidence 0.5 미만. 일반론으로 억지로 채우지 마세요.
- ${langRule}`,
      prompt: `${widgetBlock}

## Transcript (누적)
${transcriptSan.wrapped}

---
위 transcript 에 "${title}" 위젯에 담을 내용이 이미 있는지 판정하고, 있으면 추출하세요.`,
      temperature: 0.2,
      providerOptions: ZERO_RETENTION,
    });

    const obj = result.object;
    const signals = obj.signals.filter((s) => s.bullet.trim().length > 0);
    const backfilled =
      obj.matched && signals.length > 0 && obj.confidence >= 0.5;

    // confidence 숫자 → reflection persona 의 라벨 enum 으로 변환.
    const confidence: 'high' | 'medium' | 'low' | 'insufficient' = !backfilled
      ? 'insufficient'
      : obj.confidence >= 0.75
        ? 'high'
        : obj.confidence >= 0.5
          ? 'medium'
          : 'low';

    if (!backfilled) {
      return NextResponse.json({ backfilled: false, count: 0 });
    }
    return NextResponse.json({
      backfilled: true,
      count: signals.length,
      section: { summary: obj.summary, signals, confidence },
    });
  } catch (error) {
    console.error('[probing/backfill] generate error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'backfill_failed' }, { status: 502 });
  }
}
