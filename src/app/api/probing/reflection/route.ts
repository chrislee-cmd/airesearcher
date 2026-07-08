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
  DEFAULT_PERSONA_SECTIONS,
  PROBING_OUTPUT_LANGS,
  buildProbingPersonaSchema,
  buildProbingPersonaSystem,
} from '@/lib/probing-prompts';
import { sanitizeUserInput } from '@/lib/llm/sanitize';

export const maxDuration = 60;

const Body = z.object({
  // 누적 transcript — 좌패널은 직전 30초가 아닌 누적 발화를 보고 응답자
  // 전체 그림을 그린다. cap 은 suggest 와 동일 60_000 자.
  transcript_window: z.string().min(30).max(60_000),
  interview_guide: z.string().max(20_000).optional().default(''),
  // PR (probing-output-lang-select): 분석 출력 언어. 미전달 시 transcript
  // 주 언어 자동 추론 (옛 동작). 전달 시 그 언어로 강제.
  output_lang: z.enum(PROBING_OUTPUT_LANGS).optional(),
  // PR (probing-persona-dynamic-sections): 사용자 정의 커스텀 섹션. 기본 8
  // 섹션 뒤에 append 되어 persona LLM 이 함께 채운다. 미전달 시 기본 8만
  // (옛 동작). key 는 기본 8 key 와 충돌하지 않도록 클라이언트 책임 —
  // 충돌 시 catchall 특성상 뒤 정의가 아니라 기본 key 슬롯에 병합될 수 있음.
  custom_sections: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        title: z.string().min(1).max(120),
        description: z.string().max(1000).optional(),
      }),
    )
    .max(16)
    .optional(),
  // PR (probing-persona-section-configurator #470): 활성 기본 섹션 key 목록.
  // active-section SSOT — 컨트롤 패널 구성기에서 켜진 기본 섹션만 클라이언트가
  // 보낸다. 미전달 시 기본 9 전부 (옛 동작 100%). 전달 시 이 목록에 든 기본
  // 섹션만 prompt/schema 에 포함 → 꺼진 섹션은 데이터 적재 자체가 안 됨.
  // 빈 배열 = 모든 기본 제거 (custom 만으로 진행 — sections 0 이면 400).
  default_section_keys: z.array(z.string().min(1).max(64)).max(16).optional(),
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

  // 활성 기본 섹션 — default_section_keys 미전달 시 기본 9 전부 (옛 동작).
  // 전달 시 그 목록에 든 기본 섹션만 (순서는 DEFAULT_PERSONA_SECTIONS 유지).
  // 빈 배열 = 모든 기본 제거. active-section SSOT (PR #470).
  const requestedDefaultKeys = parsed.data.default_section_keys;
  const activeDefaults = requestedDefaultKeys
    ? DEFAULT_PERSONA_SECTIONS.filter((d) =>
        requestedDefaultKeys.includes(d.key),
      )
    : DEFAULT_PERSONA_SECTIONS;

  // 활성 기본 + (옵션) 사용자 custom 섹션. custom_sections 미전달 시
  // 활성 기본만 — 옛 동작 100% 보존 (default_section_keys 도 미전달 시).
  const sections = [...activeDefaults, ...(parsed.data.custom_sections ?? [])];
  // 모든 섹션이 꺼진 경우 (기본 0 + custom 0) — 채울 대상이 없어 LLM 호출
  // 무의미. 빈 schema 는 grammar 오류를 유발하므로 명시적 400.
  if (sections.length === 0) {
    return NextResponse.json({ error: 'no_sections' }, { status: 400 });
  }
  const sectionKeyList = sections.map((s) => s.key).join(' / ');

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    // 동적 schema — custom alias (custom_1..N) 를 명시적 required property 로
    // 넣어 모델이 기본 8 과 동일하게 반드시 채우게 한다. 정적 catchall schema
    // 는 custom key 를 optional (additionalProperties) 로만 노출해 누락됐다.
    schema: buildProbingPersonaSchema(sections),
    system: buildProbingPersonaSystem(sections, parsed.data.output_lang),
    prompt: `${guideBlock}## Transcript (누적)
${transcriptSan.wrapped}

---
위 transcript 만 보고 응답자의 페르소나를 ${sections.length} 섹션 (${sectionKeyList}) 으로 채우세요. 출력 JSON 의 각 섹션 key 는 이 목록과 정확히 일치해야 합니다. transcript 가 빈약한 섹션은 confidence='insufficient' + summary 빈 문자열 + signals 빈 배열로 두세요. 일반론으로 빈 칸을 채우지 마세요.`,
    // 0.3 — 같은 transcript 에서 호출마다 큰 흔들림 없도록. 0 은 너무
    // 동일한 문장을 반복, 0.4 (suggest) 보다는 보수적.
    temperature: 0.3,
    // 섹션당 (summary + signals + confidence) ~500 token. 기본 8 섹션은 4000
    // 유지, custom 섹션이 늘면 비례 상향 (cap 8000) 해 응답 절단 회피.
    maxOutputTokens: Math.min(8000, Math.max(4000, sections.length * 500)),
    // structuredOutputMode: 'jsonTool' — Anthropic 의 기본 strict structured
    // output ('outputFormat') 은 schema 를 constrained-decoding grammar 로
    // 컴파일하는데, 섹션이 10개 (기본 8 + custom 2) 를 넘으면 "compiled grammar
    // is too large" 로 요청이 거부돼 빈 스트림 → white screen 회귀가 났다.
    // jsonTool 모드는 schema 를 tool input_schema 로만 넘겨 grammar 컴파일이
    // 없다 → 섹션 수 제한 없음. custom key emit 은 required schema property +
    // 강화된 system prompt 가 담보한다 (strict 아니어도 required 필드는 강하게
    // 유도됨).
    providerOptions: {
      ...ZERO_RETENTION,
      anthropic: { structuredOutputMode: 'jsonTool' },
    },
    // 스트리밍 중 provider 에러 (rate limit / overload / invalid schema 등) 는
    // 기본적으로 삼켜져 빈 스트림으로 끝나고 client 는 empty_reflection 만 본다.
    // 실제 원인을 서버 로그에 남겨 진단 가능하게 한다 (반환 문자열은 미사용).
    onError: ({ error }) => {
      console.error('[probing/reflection] stream error', {
        sections: sections.length,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return result.toTextStreamResponse({
    headers: {
      'x-probing-guide-length': String(guideText.length),
      'x-probing-window-chars': String(transcript_window.length),
    },
  });
}
