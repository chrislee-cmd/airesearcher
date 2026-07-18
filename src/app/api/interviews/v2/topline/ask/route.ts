import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { sanitizeUserInput } from '@/lib/llm/sanitize';
import {
  searchInterviewV2Chunks,
  type InterviewV2Hit,
} from '@/lib/interview-v2/pgvector-query';
import { formatEvidence } from '@/lib/interview-v2/search-prompt';
import {
  buildAskSystem,
  askNoAnswerMd,
  buildAskWebSystem,
  askWebNoResultsMd,
  askAnswerSchema,
} from '@/lib/interview-v2/ask-prompt';
import { resolveOutputLang } from '@/lib/i18n/output-language';
import { readRequestLocale } from '@/lib/i18n/request-locale';
import { searchWeb, formatWebEvidence } from '@/lib/web-search/tavily';
import type { Citation } from '@/lib/interview-v2/types';

// 인터뷰 탑라인 drag-to-ask — 선택 구절 + 추가질문에 대한 근거 기반 답변.
//
// POST { project_id, anchor_block_id, selected_text, question }:
//   1. 검색 시드 = `${selected_text}\n${question}` 로 프로젝트 전체 chunk 를
//      top-K 벡터 검색(v2/search 임베딩→RPC 재사용). 선택 문맥이 검색을 조준.
//   2. 근거를 주입해 Sonnet 4.6 이 짧은 답변 + inline [chunk_id] citation 을
//      streamObject 로 스트리밍(v2/search 와 동일 패턴). x-citations 헤더 =
//      검색된 청크 전체(클라 인용 카드 소스).
//   3. 근거 0 개면 no_answer JSON 으로 즉시 응답(모델 호출 0).
//
// 이 라우트는 답을 스트리밍만 하고 저장하지 않는다("버리기" = 클라 롤백).
// "유지" 시 클라가 PATCH /topline/blocks 로 병합하며, 그때 citation 을
// project chunk 집합에 대해 서버가 최종 재검증한다(무효 id 0 보장).
//
// 격리/스코프: 모든 조회는 org_id 경계로 스코프. 타 org 프로젝트를 넘기면
// project_not_found(정보 누출 방지). retrieval 은 admin client(RLS 우회, 성능)
// 로 하되 RPC 의 org_id predicate 가 격리 경계 — v2/search 와 동일.

export const maxDuration = 120;

const Body = z.object({
  project_id: z.string().uuid(),
  // 탑라인 블록 anchor(data-block-id). 여기선 문맥 로그용 — 실제 삽입 위치는
  // "유지" 시 PATCH 가 검증한다. 문자열이면 충분(형식 강제는 PATCH 에서).
  anchor_block_id: z.string().trim().min(1).max(200),
  selected_text: z.string().trim().min(1).max(2_000),
  question: z.string().trim().min(1).max(2_000),
  // 근거 소스 — 'interview'(기본, 인터뷰 코퍼스 벡터 검색) / 'web'(Tavily 웹 검색).
  mode: z.enum(['interview', 'web']).optional().default('interview'),
  top_k: z.number().int().min(1).max(50).optional().default(12),
  // v2/search 와 동일한 floor(교차언어 유사도가 구조적으로 낮아 0.2 가 바닥).
  score_threshold: z.number().min(0).max(1).optional().default(0.2),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { project_id, anchor_block_id, selected_text, question, mode, top_k, score_threshold } =
    parsed.data;

  // 출력 언어 = 유저 로케일(NEXT_LOCALE) > en. drag-to-ask 는 위젯 출력언어
  // 셀렉터가 없으므로 명시 선택은 없다(#1038 로케일 폴백 축).
  const lang = resolveOutputLang(undefined, await readRequestLocale());

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  // 선택 구절 + 질문은 신뢰할 수 없는 사용자 입력 — wrap + injection 로깅
  // (차단 X, UX 회귀 방지). 두 모드(interview/web) 공통.
  const questionSan = await sanitizeUserInput(question, 'ask_question', {
    endpoint: '/api/interviews/v2/topline/ask',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: question.length,
    input_label: 'ask_question',
  });
  const selectedSan = await sanitizeUserInput(selected_text, 'ask_selected', {
    endpoint: '/api/interviews/v2/topline/ask',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: selected_text.length,
    input_label: 'ask_selected',
  });

  const anthropic = createAnthropic({ apiKey });

  // ── 웹 검색 모드 ── 인터뷰 코퍼스 대신 Tavily 웹 결과를 근거로 답한다.
  // 인용은 answer_md 의 inline markdown 링크(chunk_id 아님)라 x-citations 는
  // 빈 배열 — 클라가 chunk 인용 카드를 그리지 않는다. keep 시 PATCH 는
  // citations: [] 로 병합돼 무효 chunk_id drop 경로와 자연히 호환된다.
  if (mode === 'web') {
    const tavilyKey = env.TAVILY_API_KEY;
    if (!tavilyKey) {
      return NextResponse.json(
        { error: 'web_search_unavailable' },
        { status: 503 },
      );
    }

    const webQuery = `${selected_text} ${question}`;
    const results = await searchWeb(webQuery, {
      apiKey: tavilyKey,
      maxResults: 6,
    });

    console.log('[v2/topline/ask]', {
      mode: 'web',
      project_id: project_id.slice(0, 8),
      anchor: anchor_block_id.slice(0, 24),
      results_count: results.length,
      selected_preview: selected_text.slice(0, 40),
      question_preview: question.slice(0, 40),
    });

    const emptyCitations = encodeURIComponent('[]');

    // 결과 0 → 모델 호출 없이 no_answer(streamed 경로와 같은 JSON shape).
    if (results.length === 0) {
      return new Response(
        JSON.stringify({
          answer_md: askWebNoResultsMd(lang),
          citations: [],
          no_answer: true,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-citations': emptyCitations,
          },
        },
      );
    }

    const webSystem = `${buildAskWebSystem(lang)}\n\n## 웹 검색 결과\n${formatWebEvidence(results)}`;
    const webResult = streamObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: askAnswerSchema,
      system: webSystem,
      prompt: `## 선택한 보고서 구절\n${selectedSan.wrapped}\n\n## 추가 질문\n${questionSan.wrapped}\n\n위 웹 검색 결과만 사용해 추가 질문에 짧게 답하고, 각 사실 뒤에 출처 markdown 링크를 다세요.`,
      temperature: 0.2,
      providerOptions: ZERO_RETENTION,
    });
    const webResponse = webResult.toTextStreamResponse();
    webResponse.headers.set('x-citations', emptyCitations);
    return webResponse;
  }

  // ── 인터뷰 근거 모드(기본) ──
  // 검색 시드 = 선택 구절 + 질문 — 선택 문맥이 retrieval 을 조준한다.
  const seed = `${selected_text}\n${question}`;

  let hits: InterviewV2Hit[] = [];
  try {
    hits = await searchInterviewV2Chunks({
      client: admin,
      orgId: org.org_id,
      projectId: project_id,
      query: seed,
      k: top_k,
      scoreThreshold: score_threshold,
    });
  } catch (e) {
    console.error('[v2/topline/ask] retrieval failed', e);
    return NextResponse.json({ error: 'ask_failed' }, { status: 500 });
  }

  console.log('[v2/topline/ask]', {
    project_id: project_id.slice(0, 8),
    anchor: anchor_block_id.slice(0, 24),
    chunks_count: hits.length,
    threshold: score_threshold,
    selected_preview: selected_text.slice(0, 40),
    question_preview: question.slice(0, 40),
  });

  // 클라가 즉시 인용 카드를 그릴 수 있게 검색된 청크 전체를 x-citations 로.
  const candidates: Citation[] = hits.map((h) => ({
    chunk_id: String(h.chunk_id),
    document_id: h.document_id,
    filename: h.filename,
    project_name: h.project_name ?? undefined,
    excerpt: h.content.slice(0, 2_000),
    score: h.score,
  }));
  const citationsHeader = encodeURIComponent(JSON.stringify(candidates));

  // 근거 0 개 → 모델 호출 없이 no_answer. streamed 경로와 같은 JSON shape.
  if (hits.length === 0) {
    return new Response(
      JSON.stringify({ answer_md: askNoAnswerMd(lang), citations: [], no_answer: true }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-citations': citationsHeader,
        },
      },
    );
  }

  const systemPrompt = `${buildAskSystem(lang)}\n\n## 근거 청크\n${formatEvidence(hits)}`;

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: askAnswerSchema,
    system: systemPrompt,
    prompt: `## 선택한 보고서 구절\n${selectedSan.wrapped}\n\n## 추가 질문\n${questionSan.wrapped}\n\n위 근거 청크만 사용해 추가 질문에 짧게 답하세요.`,
    temperature: 0.1,
    providerOptions: ZERO_RETENTION,
  });

  const response = result.toTextStreamResponse();
  response.headers.set('x-citations', citationsHeader);
  return response;
}
