import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject, streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  PROBING_FOCUS_SYSTEM,
  PROBING_SYSTEM,
  probingFocusSchema,
  probingSuggestionSchema,
  type ProbingFocus,
} from '@/lib/probing-prompts';
import {
  EMPTY_GUIDE,
  hasGuideContent,
  parseProbingGuide,
  type ProbingGuide,
  type ProbingHypothesis,
  type ProbingIntent,
} from '@/lib/probing-guide';

// 위젯 trigger 는 60초 주기 — 단일 호출이 60초 안에 끝나야 다음 자동 호출이
// 겹치지 않는다. Stage 1 (haiku) ~1-2초 + Stage 2 (sonnet stream) ~5-10초 =
// 합산 ~7-12초. 마진 충분.
export const maxDuration = 60;

// Stage 1 윈도우 — "지금 응답자가 어느 가설을 건드리고 있나" 는 짧은
// 윈도우가 정확. Stage 2 는 client 가 보낸 90초 윈도우 그대로 사용.
const STAGE1_WINDOW_CHAR_BUDGET = 1500;

const Body = z.object({
  // ~500-1500 토큰 정도가 정상. cap 은 60_000 자 — 화자 모두 길게 떠들어도
  // 안전한 상한. 30글자 미만은 client 가 이미 skip 하지만 서버도 한 번 더 차단.
  transcript_window: z.string().min(30).max(60_000),
  // PR-3: client 가 활성 프로젝트 id 를 보내면 서버가 guide 를 SELECT.
  // 가이드 없는 프로젝트 / 비-활성 / null 은 모두 PR-2 동작 (legacy 단일
  // 단계) 으로 fallback.
  project_id: z.string().uuid().optional().nullable(),
  // 호환: 이전 시그니처에서 client 가 명시적으로 가이드 문자열을 보낼 수
  // 있었다. PR-3 부터는 거의 사용 안 함. project_id 가 있으면 무시.
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
  const { transcript_window, project_id, interview_guide, max_questions } =
    parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });

  // ── 가이드 로드 ─────────────────────────────────────────────
  // project_id 가 있고 org 안의 프로젝트라면 PR-3 키를 추출, 그 외 모든
  // 경로는 EMPTY_GUIDE 로 떨어진다. legacy interview_guide 문자열은
  // project_id 가 비어있을 때 보존을 위해 살려둔다.
  let guide: ProbingGuide = EMPTY_GUIDE;
  if (project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id, org_id, interview_template')
      .eq('id', project_id)
      .maybeSingle();
    if (project && project.org_id === org.org_id) {
      guide = parseProbingGuide(project.interview_template);
    }
  }

  // ── Stage 1 ─────────────────────────────────────────────────
  // 가이드 컨텐츠가 있을 때만 라벨링 호출. 가이드 없으면 PR-2 동작 그대로
  // — Stage 1 건너뛰고 Stage 2 만 호출.
  let focus: ProbingFocus | null = null;
  if (hasGuideContent(guide)) {
    const stage1Window = transcript_window.slice(-STAGE1_WINDOW_CHAR_BUDGET);
    try {
      const result = await generateObject({
        model: anthropic('claude-haiku-4-5'),
        schema: probingFocusSchema,
        system: PROBING_FOCUS_SYSTEM,
        prompt: buildFocusPrompt(guide, stage1Window),
        temperature: 0,
        maxOutputTokens: 300,
      });
      focus = sanitizeFocus(result.object, guide);
    } catch (e) {
      // Stage 1 실패는 fatal 이 아님 — 가이드 미사용으로 fallback.
      console.error('[probing/suggest] stage1 failed', e);
      focus = null;
    }
  }

  // ── Stage 2 ─────────────────────────────────────────────────
  // guide + Stage 1 의 focus 가 있으면 그 부분만 prompt 에 박는다. 가이드도
  // focus 도 없으면 PR-2 시절과 동일한 단순 prompt.
  const guideBlock = buildGuideBlock(guide, focus, interview_guide);

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

  // 위젯이 focus 도 같이 보여줄 수 있도록 응답 헤더로 실어 보냄. body 는
  // 기존과 동일한 JSON stream — partial parser 가 그대로 동작.
  const res = result.toTextStreamResponse();
  if (focus) {
    res.headers.set(
      'x-probing-focus',
      encodeURIComponent(JSON.stringify(focus)),
    );
  }
  return res;
}

// ── prompt builders ─────────────────────────────────────────────

function buildFocusPrompt(guide: ProbingGuide, transcript: string): string {
  const objective = guide.objective.trim();
  const hypos = guide.hypotheses
    .map((h) => `- id=${h.id} · ${h.label}${h.detail ? ` (${h.detail})` : ''}`)
    .join('\n');
  const intents = guide.question_intents
    .map(
      (q) =>
        `- id=${q.id} · ${q.question}${q.intent ? ` (의도: ${q.intent})` : ''}`,
    )
    .join('\n');

  return [
    objective ? `[조사목적]\n${objective}` : '',
    hypos ? `[핵심가설 — id 와 라벨]\n${hypos}` : '',
    intents ? `[질문 의도 — id 와 질문/의도]\n${intents}` : '',
    `[최근 transcript]\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildGuideBlock(
  guide: ProbingGuide,
  focus: ProbingFocus | null,
  legacyGuide: string,
): string {
  // 가이드도 legacy 문자열도 없으면 빈 블록.
  if (!hasGuideContent(guide)) {
    const trimmed = legacyGuide.trim();
    if (trimmed.length === 0) return '';
    return `\n\n[인터뷰 가이드 / RQ]\n${trimmed}\n`;
  }

  // focus 가 있으면 가설/의도를 그 id 들로 한정. 없으면 전체 노출
  // (가이드는 작지만 가설 30개·의도 40개까지 schema 가 허용하므로 작은
  // prompt 가 더 모델에 집중적임).
  const focusedHypos: ProbingHypothesis[] = focus?.relevant_hypothesis_ids
    .map((id) => guide.hypotheses.find((h) => h.id === id))
    .filter((h): h is ProbingHypothesis => !!h) ?? guide.hypotheses;
  const focusedIntents: ProbingIntent[] = focus?.relevant_intent_ids
    .map((id) => guide.question_intents.find((q) => q.id === id))
    .filter((q): q is ProbingIntent => !!q) ?? guide.question_intents;

  const lines: string[] = [];
  if (guide.objective.trim()) {
    lines.push(`[조사목적]\n${guide.objective.trim()}`);
  }
  if (focusedHypos.length > 0) {
    lines.push(
      [
        '[핵심가설 — 현재 라운드에서 우선 다룰 것]',
        ...focusedHypos.map(
          (h) => `- ${h.label}${h.detail ? ` — ${h.detail}` : ''}`,
        ),
      ].join('\n'),
    );
  }
  if (focusedIntents.length > 0) {
    lines.push(
      [
        '[질문 의도 — 현재 라운드에서 우선 다룰 것]',
        ...focusedIntents.map(
          (q) =>
            `- 질문: ${q.question}${q.intent ? ` / 의도: ${q.intent}` : ''}`,
        ),
      ].join('\n'),
    );
  }
  if (focus?.focus_summary) {
    lines.push(`[지금 응답자 발화 요약]\n${focus.focus_summary}`);
  }
  return `\n\n${lines.join('\n\n')}\n`;
}

// 모델이 가이드에 없는 id 를 환각으로 만들어내는 경우 차단. focus 가
// 빈 id 만 들고 오면 effectively 전체 가이드를 fallback 으로 사용한다.
function sanitizeFocus(raw: ProbingFocus, guide: ProbingGuide): ProbingFocus {
  const hypoIds = new Set(guide.hypotheses.map((h) => h.id));
  const intentIds = new Set(guide.question_intents.map((q) => q.id));
  return {
    relevant_hypothesis_ids: raw.relevant_hypothesis_ids.filter((id) =>
      hypoIds.has(id),
    ),
    relevant_intent_ids: raw.relevant_intent_ids.filter((id) =>
      intentIds.has(id),
    ),
    focus_summary: raw.focus_summary ?? '',
  };
}
