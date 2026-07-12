import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
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
  SECTION_SYSTEM,
  SECTION_NO_CONTENT_MD,
  askAnswerSchema,
} from '@/lib/interview-v2/ask-prompt';

// 인터뷰 탑라인 섹션 삽입 — 자연어 지시로 보고서에 끼울 한 개 섹션을 생성한다.
//
// POST { project_id, prompt }:
//   1. 검색 시드 = prompt 로 프로젝트 전체 chunk 를 top-K 벡터 검색(ask/search
//      임베딩→RPC 재사용). 선택 구절 없이 지시만으로 retrieval 을 조준한다.
//   2. 근거를 주입해 Sonnet 4.6 이 굵은 제목 + 문단(섹션 1개)을 inline
//      [chunk_id] citation 과 함께 생성한다(ask 와 같은 askAnswerSchema).
//   3. 근거 0 개면 모델 호출 없이 no_answer JSON 으로 즉시 응답.
//
// drag-to-ask(ask/route.ts)와 달리 스트리밍하지 않고 완성된 JSON({ answer_md,
// citation_ids, no_answer })을 반환한다 — 섹션은 keep/discard 없이 "제출 →
// 로딩 → 삽입" UX 라 완결 후 클라가 PATCH /topline/blocks(insert_section)로
// 영속한다(그때 citation 을 project chunk 집합에 대해 서버가 최종 재검증).
//
// 격리/스코프: 모든 조회는 org_id 경계. 타 org 프로젝트를 넘기면
// project_not_found. retrieval 은 admin client 지만 RPC 의 org_id predicate 가
// 격리 경계 — ask/search 와 동일.

export const maxDuration = 120;

const Body = z.object({
  project_id: z.string().uuid(),
  // 새 섹션을 만들 자연어 지시(예: "이 사람의 취미 섹션 추가").
  prompt: z.string().trim().min(1).max(2_000),
  top_k: z.number().int().min(1).max(50).optional().default(16),
  // drag-to-ask(0.2 floor)와 달리 섹션 생성은 코퍼스 전체를 근거로 삼으므로
  // **절대 유사도 floor 를 두지 않고 top-k 최근접을 항상 가져온다**(0). ask 는
  // 보고서에서 드래그한 코퍼스-파생 텍스트로 시드해 유사도가 높지만, 섹션은
  // 자연어 지시("취미 섹션 추가")로 시드해 유사도가 구조적으로 낮다 — 0.2 floor
  // 면 관련 청크까지 잘려 "근거 없음" 으로 오탈락한다. 무관 청크가 섞여도 모델의
  // 환각 금지 + no_answer 가드가 처리한다(청크 있으면 no_answer 오발 방지).
  score_threshold: z.number().min(0).max(1).optional().default(0),
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
  const { project_id, prompt, top_k, score_threshold } = parsed.data;

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

  // 자연어 지시는 신뢰할 수 없는 사용자 입력 — wrap + injection 로깅(차단 X).
  const promptSan = await sanitizeUserInput(prompt, 'section_prompt', {
    endpoint: '/api/interviews/v2/topline/section',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: prompt.length,
    input_label: 'section_prompt',
  });

  let hits: InterviewV2Hit[] = [];
  try {
    hits = await searchInterviewV2Chunks({
      client: admin,
      orgId: org.org_id,
      projectId: project_id,
      query: prompt,
      k: top_k,
      scoreThreshold: score_threshold,
    });
  } catch (e) {
    console.error('[v2/topline/section] retrieval failed', e);
    return NextResponse.json({ error: 'section_failed' }, { status: 500 });
  }

  console.log('[v2/topline/section]', {
    project_id: project_id.slice(0, 8),
    chunks_count: hits.length,
    threshold: score_threshold,
    prompt_preview: prompt.slice(0, 40),
  });

  // 근거 0 개 → 모델 호출 없이 no_answer.
  if (hits.length === 0) {
    return NextResponse.json({
      answer_md: SECTION_NO_CONTENT_MD,
      citation_ids: [],
      no_answer: true,
    });
  }

  const anthropic = createAnthropic({ apiKey });
  const systemPrompt = `${SECTION_SYSTEM}\n\n## 근거 청크\n${formatEvidence(hits)}`;

  let answerMd = '';
  let citationIds: string[] = [];
  let noAnswer = false;
  try {
    // 비스트리밍 — 섹션은 keep/discard 없이 "제출 → 로딩 → 삽입" 이라 완성 객체
    // 하나만 필요하다(generateObject 가 스키마 검증된 최종 객체를 반환).
    const { object: obj } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: askAnswerSchema,
      system: systemPrompt,
      prompt: `## 섹션 생성 지시\n${promptSan.wrapped}\n\n위 근거 청크만 사용해 지시에 맞는 보고서 섹션 하나를 작성하세요.`,
      temperature: 0.2,
      maxOutputTokens: 4_000,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    answerMd = obj?.answer_md ?? '';
    noAnswer = obj?.no_answer === true;
    // 검색된 청크 집합에 대해 1차 필터(최종 재검증은 keep 시 PATCH 가 수행).
    const hitIds = new Set(hits.map((h) => String(h.chunk_id)));
    citationIds = Array.from(
      new Set((obj?.citations ?? []).map((c) => String(c.chunk_id))),
    ).filter((id) => hitIds.has(id));
  } catch (e) {
    console.error('[v2/topline/section] generation failed', e);
    return NextResponse.json({ error: 'section_failed' }, { status: 500 });
  }

  console.log('[v2/topline/section] generated', {
    project_id: project_id.slice(0, 8),
    chunks_count: hits.length,
    no_answer: noAnswer,
    md_len: answerMd.length,
    citations: citationIds.length,
  });

  if (noAnswer) {
    return NextResponse.json({
      answer_md: answerMd || SECTION_NO_CONTENT_MD,
      citation_ids: [],
      no_answer: true,
    });
  }

  if (!answerMd.trim()) {
    return NextResponse.json({
      answer_md: SECTION_NO_CONTENT_MD,
      citation_ids: [],
      no_answer: true,
    });
  }

  return NextResponse.json({
    answer_md: answerMd,
    citation_ids: citationIds,
    no_answer: false,
  });
}
