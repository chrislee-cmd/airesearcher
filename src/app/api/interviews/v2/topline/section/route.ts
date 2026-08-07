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
  buildSectionSystem,
  sectionNoContentMd,
  askAnswerSchema,
} from '@/lib/interview-v2/ask-prompt';
import { fetchDocumentsWithChunks } from '@/lib/interview-v2/topline';
import {
  classifySectionMode,
  buildAggregateEvidence,
  buildAggregateSectionSystem,
  aggregateFootnoteMd,
} from '@/lib/interview-v2/section-aggregate';
import { resolveOutputLang, type OutputLang } from '@/lib/i18n/output-language';
import { readRequestLocale } from '@/lib/i18n/request-locale';

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

// 집계 모드는 캐시 미스 문서를 전수 map 할 수 있어(콜드 캐시) 여유가 필요하다.
// 일반 경로는 메인 토플라인이 추출 캐시를 pre-warm 해 빠르지만, 캐시가 비어 있는
// 프로젝트에서 처음 집계 섹션을 넣으면 문서 수만큼 map 이 돈다(동시성 제한).
export const maxDuration = 300;

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

  // 출력 언어 = 유저 로케일(NEXT_LOCALE) > en. 섹션 삽입엔 출력언어 셀렉터 없음.
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

  // 자연어 지시는 신뢰할 수 없는 사용자 입력 — wrap + injection 로깅(차단 X).
  const promptSan = await sanitizeUserInput(prompt, 'section_prompt', {
    endpoint: '/api/interviews/v2/topline/section',
    user_id: user.id,
    org_id: org.org_id,
    actor_email: user.email ?? null,
    input_length: prompt.length,
    input_label: 'section_prompt',
  });

  const anthropic = createAnthropic({ apiKey });

  // ── 의도 자동 감지 (집계 vs 탐색) ──
  // 집계(인구통계·"몇 명"·분포·비율·성비/연령대 등)는 원리적으로 전 코퍼스를
  // 읽어야 정확하다 — top-K 는 과소집계(60명 중 16명만 보고 "총 16명")한다.
  // 애매하면 aggregate(안전측 — 과소집계가 더 해롭다).
  const { mode, reason } = await classifySectionMode(anthropic, prompt);
  console.log('[v2/topline/section] mode', {
    project_id: project_id.slice(0, 8),
    mode,
    reason: reason.slice(0, 100),
    prompt_preview: prompt.slice(0, 40),
  });

  if (mode === 'aggregate') {
    return handleAggregateSection({
      admin,
      anthropic,
      orgId: org.org_id,
      projectId: project_id,
      promptSan,
      lang,
    });
  }

  // ── 탐색(narrow) 모드 = 현행 top-K 유지 (회귀 0) ──
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
      answer_md: sectionNoContentMd(lang),
      citation_ids: [],
      no_answer: true,
    });
  }

  const systemPrompt = `${buildSectionSystem(lang)}\n\n## 근거 청크\n${formatEvidence(hits)}`;

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
      answer_md: answerMd || sectionNoContentMd(lang),
      citation_ids: [],
      no_answer: true,
    });
  }

  if (!answerMd.trim()) {
    return NextResponse.json({
      answer_md: sectionNoContentMd(lang),
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

// ── 집계 모드 핸들러 (전수 순회) ────────────────────────────────────────────
// 전 문서를 순회(fetchDocumentsWithChunks)하고, 메인 토플라인이 캐시한 문서별
// 추출을 전수 근거로 삼아(캐시 미스만 map) 응답자 총수 N 을 명시 주입한 채 섹션을
// 생성한다. top-K 를 우회해 "60명 중 16명" 과소집계를 없앤다. narrow 회귀 0
// (이 경로는 mode==='aggregate' 일 때만 진입).
async function handleAggregateSection(args: {
  admin: ReturnType<typeof createAdminClient>;
  anthropic: ReturnType<typeof createAnthropic>;
  orgId: string;
  projectId: string;
  promptSan: { wrapped: string };
  lang: OutputLang;
}): Promise<Response> {
  const { admin, anthropic, orgId, projectId, promptSan, lang } = args;

  // 전 문서 로드(전수 — 샘플링 X). 기존 map-reduce 인프라 재사용.
  let docs;
  try {
    docs = await fetchDocumentsWithChunks(admin, orgId, projectId);
  } catch (e) {
    console.error('[v2/topline/section] aggregate fetch failed', e);
    return NextResponse.json({ error: 'section_failed' }, { status: 500 });
  }
  // 인덱싱된 문서가 없으면 근거 없음 — no_answer.
  if (docs.length === 0) {
    return NextResponse.json({
      answer_md: sectionNoContentMd(lang),
      citation_ids: [],
      no_answer: true,
    });
  }

  let evidence;
  try {
    evidence = await buildAggregateEvidence(admin, anthropic, orgId, docs);
  } catch (e) {
    console.error('[v2/topline/section] aggregate evidence failed', e);
    return NextResponse.json({ error: 'section_failed' }, { status: 500 });
  }

  console.log('[v2/topline/section] aggregate evidence', {
    project_id: projectId.slice(0, 8),
    total_respondents: evidence.totalRespondents,
    cache_hits: evidence.cacheHits,
    mapped_now: evidence.mappedNow,
  });

  const systemPrompt = `${buildAggregateSectionSystem(
    lang,
    evidence.totalRespondents,
  )}\n\n## 전수 응답자 추출 (${evidence.totalRespondents}명)\n${evidence.evidenceText}`;

  let answerMd = '';
  let citationIds: string[] = [];
  let noAnswer = false;
  try {
    const { object: obj } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: askAnswerSchema,
      system: systemPrompt,
      prompt: `## 섹션 생성 지시\n${promptSan.wrapped}\n\n위 전수 응답자 추출만 사용해 지시에 맞는 집계 보고서 섹션 하나를 작성하세요. 총 응답자 수(${evidence.totalRespondents}명)를 기준으로 성비·연령대·분포를 분해합니다.`,
      temperature: 0.2,
      maxOutputTokens: 4_000,
      maxRetries: 1,
      providerOptions: ZERO_RETENTION,
    });
    answerMd = obj?.answer_md ?? '';
    noAnswer = obj?.no_answer === true;
    // 전수 chunk_id 집합에 대해 재검증(지어낸 id drop) — narrow 의 hitIds 대신
    // validChunkIds 를 쓴다(전수 근거이므로).
    citationIds = Array.from(
      new Set((obj?.citations ?? []).map((c) => String(c.chunk_id))),
    ).filter((id) => evidence.validChunkIds.has(id));
  } catch (e) {
    console.error('[v2/topline/section] aggregate generation failed', e);
    return NextResponse.json({ error: 'section_failed' }, { status: 500 });
  }

  console.log('[v2/topline/section] aggregate generated', {
    project_id: projectId.slice(0, 8),
    total_respondents: evidence.totalRespondents,
    no_answer: noAnswer,
    md_len: answerMd.length,
    citations: citationIds.length,
  });

  if (noAnswer || !answerMd.trim()) {
    return NextResponse.json({
      answer_md: answerMd || sectionNoContentMd(lang),
      citation_ids: [],
      no_answer: true,
    });
  }

  // 커버리지 투명성 푸트노트(경량) — 전수 N명 기준임을 미세 표기.
  return NextResponse.json({
    answer_md: answerMd + aggregateFootnoteMd(lang, evidence.totalRespondents),
    citation_ids: citationIds,
    no_answer: false,
  });
}
