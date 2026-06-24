import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { spendCredits, refundCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import {
  crawlSource,
  dedupeArticles,
  sourceMissingKey,
  SOURCE_BUDGET,
} from '@/lib/desk-crawl';
import { pickRepresentativeArticles } from '@/lib/desk-embed';
import { getCache, hashString, setCache } from '@/lib/cache';
import type { DeskDateRange } from '@/lib/desk-crawl';
import {
  DESK_SOURCES,
  type DeskArticle,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';

export const maxDuration = 300;

const SOURCE_IDS = [
  'naver_news',
  'naver_blog',
  'naver_cafe',
  'naver_kin',
  'kakao_web',
  'kakao_blog',
  'kakao_cafe',
  'youtube',
  'google_news',
  'gdelt_news',
  'hacker_news',
  'reddit',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  keywords: z.array(z.string().min(1).max(120)).min(1).max(10),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
  locale: z.enum(['ko', 'en']).optional(),
  region: z.enum(['KR', 'US', 'SG', 'MY', 'TH', 'JP', 'GLOBAL']).optional(),
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const EXPAND_SYSTEM = `당신은 데스크 리서치를 위해 사용자가 입력한 키워드의 검색 적합 유사 키워드를 만드는 보조자입니다.
- 의미가 가깝거나 함께 검색되는 변형을 4개 제시합니다.
- 한국어 입력이면 한국어 위주, 영어 입력이면 영어 위주로 작성하되 통용되는 영문/한글 표기는 섞어도 됩니다.
- 결과는 콤마(,)로만 구분된 한 줄로 출력. 따옴표/번호/설명 금지.`;

const REPORT_SYSTEM = `당신은 데스크 리서치 보고서를 작성하는 전문 리서처입니다. 입력으로 키워드, 유사 키워드, 그리고 여러 출처에서 수집한 기사/포스트/영상 헤드라인 + 요약 목록을 받습니다.

[작성 원칙]
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 본문은 정중한 **존댓말**로 작성합니다 — 모든 서술은 '-입니다 / -합니다 / -하였습니다 / -보입니다 / -로 보입니다' 어미를 사용합니다. 반말('-다', '-한다', '-이다')과 명사형 종결('-함', '-됨')은 금지합니다.
- 섹션 헤더 앞에 의미가 통하는 이모지를 1개씩 붙입니다 (예: 🧾, 📈, 📰, 🔎, 🧭, ⚠️).
- 모든 링크는 반드시 \`[제목](URL)\` 형식의 markdown 링크입니다. 절대 raw URL을 본문에 노출하지 않습니다.
- 강조는 **굵게**, 인용은 \`> 인용문\` 형식을 사용할 수 있습니다.
- 사실을 임의로 추가하지 않고 제공된 자료에만 근거합니다. 자료에 없는 수치·날짜·이름은 만들어내지 않습니다.
- 출처가 둘 이상이면 통합·교차 검증해서 일치하는 부분과 상충하는 부분을 함께 다룹니다.
- **수치는 [정량 지표] 블록에 미리 계산되어 제공됩니다.** TL;DR / 트렌드 / 채널별 관찰 / 키워드 비교에서는 가능한 한 그 수치(건수·%)를 그대로 인용해서 정량적인 근거를 함께 제시합니다. 자료에 있는 숫자만 사용하고, 임의로 새 통계를 만들지 않습니다.

[필수 섹션 — 이 순서대로]
1. \`# 🗞 데스크 리서치 요약\` — 키워드와 수집 기간을 표지에 표기합니다.
2. \`## 🧾 핵심 요약 (TL;DR)\` — 5~7개 불릿. 각 항목은 한 문장으로 가장 중요한 발견·시그널을 압축합니다.
3. \`## 📈 주요 흐름 / 트렌드\` — 3~5개 단락. 반복 등장하는 토픽, 시간 순 흐름, 상반된 시각, 톤(긍정/부정/중립)을 함께 짚습니다. 가능하면 \`> 인용문\` 으로 대표 발언을 1~2개 끼워 넣습니다.
4. \`## 🧭 키워드/주체 비교\` — (입력 키워드가 2개 이상일 때만 작성). 각 키워드(또는 브랜드/주체)별로 \`### 키워드 이름\` 소제목 + 1~2단락. 누가 어떤 화제로 더 많이 언급되는지, 톤·관심사가 어떻게 다른지 비교합니다.
5. \`## 📰 채널별 관찰\` — 데이터가 있는 채널만 \`### 네이버 뉴스\` / \`### 다음 블로그\` / \`### 유튜브\` 등 소제목으로 시작하고 각 1~2단락을 작성합니다. 채널마다 톤·관점·주된 콘텐츠 유형이 어떻게 다른지 명시합니다.
6. \`## 🔎 주목할 항목\` — 시그널이 강한 10~15개. 줄마다 \`- [제목](URL) — 한 줄 요약 (출처 · 날짜)\` 형식. 가능한 한 다양한 채널·키워드를 고르게 섞습니다.
7. \`## ⚠️ 한계 / 추가 조사 제안\` — 3~5개 불릿. 데이터 부족 영역, 편향 가능성, 후속 리서치 아이디어를 함께 적습니다.

분량은 충실하게 작성하되 불필요하게 늘리지 않으며, 각 단락은 의미 있는 정보가 담길 때만 둡니다.`;

const RQ_DECOMPOSE_SYSTEM = `당신은 톱티어 컨설팅 펌(맥킨지/베인/BCG)의 시니어 리서처입니다. 사용자가 입력한 키워드, 검색 지역, 수집 기간을 보고 — 이 데스크 리서치가 답해야 할 핵심 리서치 질문(Research Questions, RQ) 5~8개를 한국어로 분해합니다.

[원칙]
- 각 질문은 단일 주제로 분리되고, "예/아니오" 가 아닌 분석형 질문이어야 합니다 (예: "X 시장 규모는 얼마이며 최근 3년 CAGR 은?").
- 질문은 서로 의미가 명확히 구분되어야 하며, 같은 정보를 두 번 묻지 않습니다.
- 시장규모 / 경쟁·플레이어 / 트렌드 / 규제·리스크 / 사용자 시그널 / 비즈모델 / 기술 — 이 7가지 카테고리 중에서 가능한 한 다양하게 커버합니다 (모든 카테고리를 다 채우려고 무리하지 마세요).
- 입력 키워드가 이미 좁은 도메인이면 그 도메인 안에서 깊이 있게, 넓으면 핵심을 추려서 폭넓게 분해합니다.

[카테고리 enum]
- market_size: 시장 규모·성장률·거래량
- competition: 주요 플레이어·M&A·신규 진입자
- trends: 신호·반복 등장 토픽·시간 흐름
- regulation_risk: 규제·정책·리스크·소송
- user_signals: 사용자/소비자 반응·여론·페인포인트
- business_model: 수익화·가격·유닛 이코노믹스
- technology: 기술 스택·R&D·특허

[중요도]
- 1(보조) ~ 5(필수) 로 매깁니다. 평균 3 근처로 분포하도록 — 모두 5 로 만들지 마세요.

JSON schema 에 정확히 맞추세요.`;

const CLAIM_EXTRACT_SYSTEM = `당신은 데스크 리서치 보고서를 뒷받침할 evidence 를 articles 에서 추출하는 분석가입니다. 한 개의 article (제목 + 요약 + URL + 출처) 을 받아 정량주장(quant) 과 엔티티(entity) 를 뽑아냅니다.

[정량주장 (quant)]
- 시장규모·성장률·거래액·MAU·DAU·매출·점유율 같은 숫자가 들어간 주장.
- value 는 원문에 등장하는 형태 그대로 (예: "1.2조원", "12%", "3.5M"). 직접 단위 변환 X.
- unit 은 부가 단위 (예: "원", "%", "건"). 분리가 어려우면 비워둡니다.
- subject 는 무엇에 대한 수치인지 한국어 1줄 (예: "국내 OTT 광고 시장 규모").
- source_quote 는 article 의 제목·요약에서 그 주장의 근거가 된 부분을 그대로 옮긴 한 줄.

[엔티티 (entity)]
- 회사·인물·제품·기관 이름.
- role 은 'company' | 'person' | 'product' | 'org' 중 하나.
- source_quote 는 위와 동일.

[카테고리 매칭]
- rq_ids 에는 입력으로 받은 RQ 목록 (id + 질문) 중 이 claim 이 답하는 데 도움이 되는 RQ id 를 0~3개 고릅니다. 확신이 없으면 빈 배열.

[신뢰도]
- direct: article 이 직접 인용·출처·원자료를 명시
- paraphrased: 다른 자료를 재해석·요약한 톤
- speculation: 추정·전망·예상 톤 ("~할 것으로 보인다")

[규칙]
- 명백한 사실/숫자만. 광고성 슬로건·추상적 표현은 추출 X.
- article 에 정량주장이 0개일 수도 있고, 5개 넘을 수도 있습니다. 무리하게 채우지 마세요.
- 한 article 에서 보통 quant 0~3 + entity 0~5 정도가 적절. 최대 quant 5 / entity 8.
- 한국어로 작성합니다.`;

const ANALYTICS_SYSTEM = `당신은 방금 작성된 데스크 리서치 보고서를 시각적으로 뒷받침할 정량 분석 차트를 설계합니다.

원칙:
- 차트는 보고서 본문이 주장하는 인사이트를 그림으로 보여주는 보조 자료입니다. 수집 메타데이터(소스 카운트, API 호출 수 같은 것)는 사용하지 마세요.
- 콘텐츠 기반 분석에 집중합니다 — 토픽 분포, 톤(긍정/중립/부정), 키워드/주체별 비교, 유형(신제품/마케팅/실적/리스크 등) 분포처럼 보고서 안에 의미가 있는 차원.
- 2~4개의 차트를 만듭니다. 그 중 **최소 1개는 합이 100% 인 비율 분포(파이 또는 누적 비율 막대)** 입니다.
- 같은 인사이트를 두 번 그리지 마세요.
- 모든 라벨/제목/insight 는 한국어 존댓말. 라벨은 4~12자 정도로 짧게.
- 데이터에 없는 수치는 만들지 말고, 보고서 본문이 시사하는 분포를 합리적으로 추정합니다.`;

const ChartSchema = z.object({
  type: z.enum(['bar', 'pie']),
  title: z.string().min(1).max(60),
  insight: z.string().min(1).max(200),
  unit: z.enum(['percent', 'count']),
  data: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        value: z.number().nonnegative(),
      }),
    )
    .min(2)
    .max(8),
});

const AnalyticsSchema = z.object({
  charts: z.array(ChartSchema).min(2).max(4),
});

const RQ_CATEGORIES = [
  'market_size',
  'competition',
  'trends',
  'regulation_risk',
  'user_signals',
  'business_model',
  'technology',
] as const;

const ResearchQuestionSchema = z.object({
  id: z.string().min(1).max(16),
  question: z.string().min(4).max(200),
  category: z.enum(RQ_CATEGORIES),
  importance: z.number().int().min(1).max(5),
});

const RQDecomposeSchema = z.object({
  research_questions: z.array(ResearchQuestionSchema).min(3).max(10),
});

type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

// Per-article claim extraction. Haiku is cheap enough to call once per
// representative article, so we keep the schema strict and skip articles
// whose payload comes back unparseable instead of retrying.
const QuantClaimSchema = z.object({
  kind: z.literal('quant'),
  value: z.string().min(1).max(80),
  unit: z.string().max(40).optional(),
  subject: z.string().min(1).max(160),
  source_quote: z.string().min(1).max(400),
  rq_ids: z.array(z.string().min(1).max(16)).max(3),
  confidence: z.enum(['direct', 'paraphrased', 'speculation']),
});

const EntityClaimSchema = z.object({
  kind: z.literal('entity'),
  name: z.string().min(1).max(120),
  role: z.enum(['company', 'person', 'product', 'org']),
  source_quote: z.string().min(1).max(400),
  rq_ids: z.array(z.string().min(1).max(16)).max(3),
  confidence: z.enum(['direct', 'paraphrased', 'speculation']),
});

const ClaimExtractSchema = z.object({
  quant: z.array(QuantClaimSchema).max(5),
  entities: z.array(EntityClaimSchema).max(8),
});

// Persisted form — flattened, tagged with the source article + tier so the
// runner can write one combined `claims` array to the row without losing
// provenance. Kind is preserved on each row.
type PersistedClaim =
  | {
      kind: 'quant';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      value: string;
      unit?: string;
      subject: string;
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    }
  | {
      kind: 'entity';
      article_url: string;
      tier: 'T1' | 'T2' | 'T3' | 'unknown';
      name: string;
      role: 'company' | 'person' | 'product' | 'org';
      source_quote: string;
      rq_ids: string[];
      confidence: 'direct' | 'paraphrased' | 'speculation';
    };

function getModel(): LanguageModel {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  return createAnthropic({ apiKey })('claude-sonnet-4-6');
}

// Haiku — used for the per-article claim extraction loop. Spec calls out
// `claude-haiku-4-5-20251001` so the loop's cost stays well below summarize's.
function getClaimModel(): LanguageModel {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  return createAnthropic({ apiKey })('claude-haiku-4-5-20251001');
}

// Analytics runs on a separate provider (OpenAI gpt-4o-mini) so its rate
// limit pool doesn't share Anthropic's 30k input tokens/min bucket. The
// long-form report stays on Sonnet for quality; only the structured chart
// extraction moves to OpenAI.
function getAnalyticsModel(): LanguageModel | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({ apiKey })('gpt-4o-mini');
}

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCES.find((s) => s.id === id)?.label ?? id;
}

type ProgressShape = {
  phase?:
    | 'expanding'
    | 'scoping'
    | 'crawling'
    | 'extracting'
    | 'summarizing';
  crawl_total?: number;
  crawl_done?: number;
  events: string[];
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { keywords, sources, locale = 'ko', region: regionInput, dateFrom, dateTo, project_id } = parsed.data;
  // Default region from locale: Korean researchers default to KR sources,
  // English researchers default to GLOBAL (Google News will use US/en).
  const region = regionInput ?? (locale === 'ko' ? 'KR' : 'GLOBAL');
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
  }

  const cleanKeywords = Array.from(
    new Set(keywords.map((k) => k.trim()).filter(Boolean)),
  ).slice(0, 10);
  if (cleanKeywords.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  const skipped: { source: DeskSourceId; missing: string }[] = [];
  const usable: DeskSourceId[] = [];
  for (const s of sources as DeskSourceId[]) {
    const missing = sourceMissingKey(s);
    if (missing) skipped.push({ source: s, missing });
    else usable.push(s);
  }
  if (usable.length === 0) {
    return NextResponse.json(
      { error: 'no_usable_sources', skipped },
      { status: 400 },
    );
  }

  const initialEvents: string[] = [
    `키워드 ${cleanKeywords.length}개를 받았어요${
      cleanKeywords.length > 1
        ? ` (${cleanKeywords.map((k) => `‘${k}’`).join(', ')})`
        : ` — ‘${cleanKeywords[0]}’`
    }. 검색 준비할게요.`,
  ];
  if (dateFrom || dateTo) {
    initialEvents.push(
      `기간은 ${dateFrom ?? '전체'} ~ ${dateTo ?? '오늘'} 으로 좁혀서 봅니다.`,
    );
  }

  // Insert the durable job row first (status=queued). The client polls /jobs
  // or subscribes via Realtime — this request itself returns immediately.
  const initialProgress: ProgressShape = { events: initialEvents };
  const { data: job, error: insertErr } = await supabase
    .from('desk_jobs')
    .insert({
      org_id: org.org_id,
      project_id: project_id ?? null,
      user_id: user.id,
      keywords: cleanKeywords,
      sources: usable as unknown as string[],
      locale,
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      status: 'queued',
      progress: initialProgress as unknown as object,
      skipped: skipped.length > 0 ? (skipped as unknown as object) : null,
      credits_spent: FEATURE_COSTS.desk,
    })
    .select('id')
    .single();
  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // Pass job.id as the idempotency key so a downstream refund (on
  // crawl/summarize failure) can reverse this exact charge.
  const spend = await spendCredits(org.org_id, 'desk', job.id);
  if (!spend.ok) {
    await supabase.from('desk_jobs').delete().eq('id', job.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // Schedule the heavy work to run after the response is returned. Vercel
  // keeps the function alive up to maxDuration (300s) — enough headroom for
  // even 10 keywords × 11 sources × API latency.
  after(() =>
    runJob({
      jobId: job.id,
      orgId: org.org_id,
      userId: user.id,
      keywords: cleanKeywords,
      usable,
      locale,
      region,
      range: { from: dateFrom, to: dateTo },
      initialEvents,
    }),
  );

  return NextResponse.json({ job_id: job.id });
}

// ─── Background runner ───────────────────────────────────────────────────────
async function runJob(args: {
  jobId: string;
  orgId: string;
  userId: string;
  keywords: string[];
  usable: DeskSourceId[];
  locale: 'ko' | 'en';
  region: DeskRegion;
  range: DeskDateRange;
  initialEvents: string[];
}) {
  const { jobId, orgId, userId, keywords, usable, locale, region, range, initialEvents } = args;
  const admin = createAdminClient();
  const events: string[] = [...initialEvents];
  let crawlDone = 0;
  let crawlTotal = 0;

  type Patch = Partial<{
    status: 'queued' | 'expanding' | 'crawling' | 'summarizing' | 'done' | 'error';
    progress: ProgressShape;
    similar_keywords: string[];
    output: string;
    articles: unknown;
    analytics: unknown;
    research_questions: unknown;
    claims: unknown;
    error_message: string;
    generation_id: string;
  }>;

  async function patch(update: Patch) {
    await admin.from('desk_jobs').update(update).eq('id', jobId);
  }
  // Cooperative cancel — the cancel endpoint just flips a row flag, runner
  // checks at every phase boundary. We throw a tagged error so the outer
  // try/catch can finalise status='cancelled' instead of 'error'.
  class CancelledError extends Error {
    constructor() {
      super('cancelled');
      this.name = 'CancelledError';
    }
  }
  async function checkCancel() {
    const { data } = await admin
      .from('desk_jobs')
      .select('cancel_requested')
      .eq('id', jobId)
      .single();
    if (data?.cancel_requested) throw new CancelledError();
  }
  function pushEvent(text: string) {
    events.push(text);
    if (events.length > 80) events.splice(0, events.length - 80);
  }
  async function pushAndPatch(text: string, phase?: ProgressShape['phase']) {
    pushEvent(text);
    await patch({
      progress: {
        phase,
        crawl_total: crawlTotal,
        crawl_done: crawlDone,
        events: [...events],
      },
    });
  }

  // Reverse the upfront charge whenever the job ends without producing a
  // result. Idempotent — safe to call from any failure path; a second call
  // returns ok without re-crediting (see credit_refund RPC).
  async function refundOnFailure(reason: string) {
    const result = await refundCredits(orgId, userId, 'desk', jobId);
    if (!result.ok && result.reason !== 'not_found') {
      console.error('[desk] refund failed', { jobId, reason, refundReason: result.reason });
    }
  }

  try {
    let model: LanguageModel;
    try {
      model = getModel();
    } catch {
      await refundOnFailure('missing_anthropic_key');
      await patch({ status: 'error', error_message: 'missing_anthropic_key' });
      return;
    }

    await checkCancel();

    let similar: string[] = [];
    if (keywords.length === 1) {
      await patch({ status: 'expanding' });
      await pushAndPatch(
        '한 키워드라 비슷한 표현도 같이 찾으면 더 풍부하겠어요. AI한테 4개 더 받아올게요…',
        'expanding',
      );
      // Same keyword + locale always yields the same suggestions (modulo
      // model/temperature drift, which we accept). Cache cross-org/cross-user
      // because the output isn't user-specific. Bump 'v1' if EXPAND_SYSTEM
      // changes meaningfully.
      const expandKey = `desk-expand:v1:${locale}:${hashString(keywords[0].trim().toLowerCase())}`;
      try {
        const cached = await getCache<string[]>(expandKey);
        if (cached && Array.isArray(cached)) {
          similar = cached;
        } else {
          const { text } = await generateText({
            model,
            system: EXPAND_SYSTEM,
            prompt: keywords[0],
            temperature: 0.3,
          });
          similar = text
            .trim()
            .split(/[,\n]/)
            .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
            .filter(Boolean)
            .filter((k) => k.toLowerCase() !== keywords[0].toLowerCase())
            .slice(0, 4);
          if (similar.length > 0) {
            void setCache(expandKey, similar);
          }
        }
      } catch (err) {
        console.error('[desk] expandKeywords failed', err);
      }
      if (similar.length) {
        await pushAndPatch(
          `유사 키워드: ${similar.map((k) => `‘${k}’`).join(', ')} — 이 표현들도 함께 검색합니다.`,
          'expanding',
        );
      } else {
        await pushAndPatch('유사 키워드는 못 만들었어요. 입력 키워드만으로 갑니다.', 'expanding');
      }
      await patch({ similar_keywords: similar });
    } else {
      await pushAndPatch(
        '여러 키워드라 사용자가 직접 큐레이션한 걸로 보고, 유사 키워드 확장은 건너뜁니다.',
        'expanding',
      );
    }

    await checkCancel();

    // ── Phase: scoping (RQ decomposition) ──────────────────────────────────
    // Top-tier desk research starts from a structured question list, not a
    // bag of search hits. Sonnet here so we get well-formed analytical
    // questions; this is a single call so latency is bounded.
    let researchQuestions: ResearchQuestion[] = [];
    await pushAndPatch(
      '먼저 이 데스크 리서치가 답해야 할 핵심 리서치 질문을 5~8개로 정리할게요…',
      'scoping',
    );
    try {
      const allKw = [...keywords, ...similar];
      const rqPrompt = [
        `메인 키워드: ${keywords.join(', ')}`,
        `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
        `검색 지역: ${region}`,
        `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
        '',
        `위 정보를 바탕으로 데스크 리서치에 필요한 RQ 5~8개를 JSON 으로 분해해주세요. 모든 키워드(${allKw.join(', ')})를 통합적으로 다루는 질문이어야 합니다.`,
      ].join('\n');
      const rqResult = await generateObject({
        model,
        system: RQ_DECOMPOSE_SYSTEM,
        prompt: rqPrompt,
        schema: RQDecomposeSchema,
        temperature: 0.3,
        maxOutputTokens: 2000,
        maxRetries: 1,
      });
      researchQuestions = rqResult.object.research_questions;
      await patch({ research_questions: researchQuestions });
      await pushAndPatch(
        `리서치 질문 ${researchQuestions.length}개를 정리했어요. 이제 자료를 수집할게요.`,
        'scoping',
      );
    } catch (err) {
      console.error('[desk] scoping failed', err);
      await refundOnFailure('scoping_failed');
      await patch({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'scoping_failed',
      });
      return;
    }

    await checkCancel();

    const allKeywords = [...keywords, ...similar];
    crawlTotal = allKeywords.length * usable.length;
    await patch({ status: 'crawling' });
    // Split each source's budget evenly across keywords. Without this, the
    // first keyword's pull races to the source's full 500 cap and rate-limits
    // / latency starve the later keywords. ceil() means small budgets still
    // give every keyword at least 1 slot.
    const perKwLimit = Math.max(
      1,
      Math.ceil(SOURCE_BUDGET / Math.max(allKeywords.length, 1)),
    );
    const sourceList = Array.from(new Set(usable.map(sourceLabelKo))).join(', ');
    await pushAndPatch(
      `이제 ${allKeywords.length}개 키워드 × ${usable.length}개 소스 = ${crawlTotal}회 검색을 동시에 돌릴게요. 키워드당 소스별 ${perKwLimit}건씩 균등 분배합니다. (${sourceList})`,
      'crawling',
    );

    const collected: DeskArticle[] = [];
    const tasks = allKeywords.flatMap((kw) =>
      usable.map((src) =>
        crawlSource(src, kw, region, range, perKwLimit)
          .then(async (items) => {
            crawlDone += 1;
            collected.push(...items);
            await pushAndPatch(
              `${sourceLabelKo(src)} · ‘${kw}’ — ${items.length}건 가져왔어요. (${crawlDone}/${crawlTotal})`,
              'crawling',
            );
          })
          .catch(async (err) => {
            crawlDone += 1;
            await pushAndPatch(
              `${sourceLabelKo(src)} · ‘${kw}’ — 실패했어요 (${err instanceof Error ? err.message : 'unknown'}).`,
              'crawling',
            );
          }),
      ),
    );
    await Promise.all(tasks);
    await checkCancel();

    // Now that per-source pulls aim at 500, the dedupe pool can balloon to
    // a few thousand. Keep a generous global cap so the LLM still gets fed,
    // but bounded enough to fit the model context.
    const articles = dedupeArticles(collected).slice(0, 1500);
    await pushAndPatch(
      `수집 끝났습니다. 중복 정리하고 ${articles.length}건으로 추렸어요.`,
      'crawling',
    );

    if (articles.length === 0) {
      const output = `# 데스크 리서치 요약\n\n키워드 \`${keywords.join(', ')}\` 로 수집된 항목이 없습니다. 키워드·기간·소스 조합을 바꿔 보세요.`;
      const { data: gen } = await admin
        .from('generations')
        .insert({
          org_id: orgId,
          user_id: userId,
          feature: 'desk',
          input: JSON.stringify({ keywords, sources: usable, locale, range }),
          output,
          credits_spent: FEATURE_COSTS.desk,
        })
        .select('id')
        .single();
      await patch({
        status: 'done',
        output,
        articles: [] as unknown as object,
        generation_id: gen?.id,
      });
      return;
    }

    // ── Concurrency throttle ──────────────────────────────────────────────
    // Anthropic 30k input tokens/min is shared across the whole org. Without
    // this gate, 5 simultaneous users all fire summarize within a few seconds
    // and the slowest 3 hit 429. We poll the desk_jobs table for how many
    // other rows are currently in 'summarizing' state and wait our turn.
    // The whole loop is bounded by MAX_WAIT_MS so we never silently extend
    // past the function's maxDuration.
    // Tightened so the concurrency wait can't eat the entire remaining
    // 5-minute budget after a heavy crawl. A 90s wait + ~3min crawl was
    // leaving generateText with no room to finish; the catch block never
    // ran and jobs froze in 'summarizing'.
    const MAX_CONCURRENT_SUMMARIZE = 2;
    const MAX_WAIT_MS = 20_000;
    const POLL_MS = 3000;
    const waitStart = Date.now();
    while (true) {
      await checkCancel();
      const { count } = await admin
        .from('desk_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'summarizing')
        .neq('id', jobId);
      if ((count ?? 0) < MAX_CONCURRENT_SUMMARIZE) break;
      if (Date.now() - waitStart > MAX_WAIT_MS) {
        await pushAndPatch(
          '대기열이 길어요. 그래도 한 번 시도해 볼게요.',
          'summarizing',
        );
        break;
      }
      await pushAndPatch(
        `다른 사용자 ${count}명이 보고서 작성 중이에요. 잠시 기다릴게요…`,
        'summarizing',
      );
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    await patch({ status: 'summarizing' });

    // ── Sample down to a representative subset for the LLM ──────────────
    // Anthropic Tier 1 한도 = 30k input tokens / min. 1500건 풀을 그대로 보내면
    // 단일 호출에 ~300k tokens 가 필요해 즉시 429. 임베딩 클러스터링으로
    // 의미적으로 다양한 80건만 추려서 보냄. 실패 시 키워드/소스 균등 fallback.
    // UI/DB 에는 1500 풀 그대로 저장됨.
    // Halved from 80 to keep the prompt + output well under the per-minute
    // token budget AND finish within the function deadline. Empirically the
    // representative-50 picks give nearly identical report quality.
    const SUMMARIZE_SAMPLE_K = 50;
    let articlesForLLM = articles;
    if (articles.length > SUMMARIZE_SAMPLE_K) {
      await pushAndPatch(
        `${articles.length}건은 한 번에 다 못 넣어서, 임베딩으로 의미가 다양한 ${SUMMARIZE_SAMPLE_K}건을 골라낼게요…`,
        'summarizing',
      );
      try {
        articlesForLLM = await pickRepresentativeArticles(
          articles,
          SUMMARIZE_SAMPLE_K,
        );
        await pushAndPatch(
          `대표 ${articlesForLLM.length}건 골랐어요.`,
          'summarizing',
        );
      } catch (err) {
        console.error('[desk] sampling failed', err);
        articlesForLLM = articles.slice(0, SUMMARIZE_SAMPLE_K);
        await pushAndPatch(
          '의미 분석은 실패했지만 80건으로 줄여서 진행할게요.',
          'summarizing',
        );
      }
    }

    // ── Phase: extracting (per-article claim extraction) ───────────────────
    // Haiku is cheap enough to invoke once per representative article, so we
    // process the ~50-article sample in small parallel chunks. Failures here
    // are non-fatal — claim extraction is best-effort, and a missing/partial
    // `claims` payload should not block the report. The report prompt below
    // just gets a richer payload when extraction succeeds.
    const persistedClaims: PersistedClaim[] = [];
    await pushAndPatch(
      `대표 ${articlesForLLM.length}건에서 정량주장 + 엔티티를 추출할게요…`,
      'extracting',
    );
    try {
      const claimModel = getClaimModel();
      const rqDigest = researchQuestions
        .map((rq) => `${rq.id}: ${rq.question}`)
        .join('\n');
      const CLAIM_CONCURRENCY = 5;
      let extracted = 0;
      for (let i = 0; i < articlesForLLM.length; i += CLAIM_CONCURRENCY) {
        await checkCancel();
        const chunk = articlesForLLM.slice(i, i + CLAIM_CONCURRENCY);
        await Promise.all(
          chunk.map(async (a) => {
            const tier = a.tier ?? 'unknown';
            const prompt = [
              `요청 언어: 한국어`,
              `리서치 질문 목록:`,
              rqDigest || '(없음)',
              '',
              `--- article ---`,
              `source: ${a.source}`,
              `tier: ${tier}`,
              `title: ${a.title}`,
              `url: ${a.url}`,
              a.publishedAt ? `published: ${a.publishedAt}` : '',
              a.snippet ? `snippet: ${a.snippet.slice(0, 800)}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            try {
              const result = await generateObject({
                model: claimModel,
                system: CLAIM_EXTRACT_SYSTEM,
                prompt,
                schema: ClaimExtractSchema,
                temperature: 0.2,
                maxOutputTokens: 1500,
                maxRetries: 1,
              });
              for (const q of result.object.quant) {
                persistedClaims.push({
                  kind: 'quant',
                  article_url: a.url,
                  tier,
                  value: q.value,
                  unit: q.unit,
                  subject: q.subject,
                  source_quote: q.source_quote,
                  rq_ids: q.rq_ids,
                  confidence: q.confidence,
                });
              }
              for (const e of result.object.entities) {
                persistedClaims.push({
                  kind: 'entity',
                  article_url: a.url,
                  tier,
                  name: e.name,
                  role: e.role,
                  source_quote: e.source_quote,
                  rq_ids: e.rq_ids,
                  confidence: e.confidence,
                });
              }
            } catch (err) {
              // Per-article failure is silent — the rest of the chunk and
              // subsequent chunks keep going. Log so we can spot systemic
              // breakage in Vercel logs.
              console.error('[desk] claim extract failed', { url: a.url, err });
            }
          }),
        );
        extracted += chunk.length;
        await pushAndPatch(
          `주장 추출 ${extracted}/${articlesForLLM.length} — 누적 ${persistedClaims.length}개.`,
          'extracting',
        );
      }
      await patch({ claims: persistedClaims });
      await pushAndPatch(
        `주장 추출 완료 — 총 ${persistedClaims.length}개 (정량 ${persistedClaims.filter((c) => c.kind === 'quant').length}, 엔티티 ${persistedClaims.filter((c) => c.kind === 'entity').length}).`,
        'extracting',
      );
    } catch (err) {
      // CancelledError must still propagate so the outer handler can mark
      // status='cancelled' + refund. Everything else (missing API key, etc)
      // is swallowed — extraction is best-effort.
      if (err instanceof CancelledError) throw err;
      console.error('[desk] extracting phase failed', err);
      await patch({ claims: [] });
      await pushAndPatch(
        '주장 추출에 실패했어요. 보고서는 그대로 진행할게요.',
        'extracting',
      );
    }

    await checkCancel();

    await pushAndPatch(
      '이제 Claude한테 한 편의 데스크 리서치 보고서로 묶어 달라고 요청할게요…',
      'summarizing',
    );

    // Compact view of the just-extracted claims so the existing REPORT_SYSTEM
    // can lean on them for the [정량 지표] block without changing its
    // structure. PR-2 will replace this with a structured ingestion.
    const claimsDigest = (() => {
      if (persistedClaims.length === 0) return '(추출된 정량주장 없음)';
      const quant = persistedClaims.filter((c) => c.kind === 'quant');
      const entities = persistedClaims.filter((c) => c.kind === 'entity');
      const quantLines = quant.slice(0, 40).map((c) => {
        if (c.kind !== 'quant') return '';
        const unit = c.unit ? ` ${c.unit}` : '';
        return `- ${c.subject}: ${c.value}${unit} (${c.tier} · ${c.confidence}) — ${c.source_quote.slice(0, 120)}`;
      });
      const entLines = entities.slice(0, 30).map((c) => {
        if (c.kind !== 'entity') return '';
        return `- ${c.name} (${c.role}, ${c.tier})`;
      });
      return [
        `정량주장 ${quant.length}개 (앞 ${Math.min(40, quant.length)}개 표시):`,
        ...quantLines,
        '',
        `주요 엔티티 ${entities.length}개 (앞 ${Math.min(30, entities.length)}개 표시):`,
        ...entLines,
      ].join('\n');
    })();

    const userMsg = [
      `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
      `메인 키워드: ${keywords.join(', ')}`,
      `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
      `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      `전체 수집: ${articles.length}건 (이 중 의미가 다양한 ${articlesForLLM.length}건을 본문에 첨부)`,
      '',
      '--- 추출된 정량 클레임 / 엔티티 (참고용) ---',
      claimsDigest,
      '',
      '--- 항목 목록 ---',
      articlesForLLM
        .map((a, i) => {
          const lines = [
            `${i + 1}. [${a.source}] ${a.title}`,
            `   url: ${a.url}`,
            a.tier ? `   tier: ${a.tier}` : '',
            a.origin ? `   origin: ${a.origin}` : '',
            a.publishedAt ? `   published: ${a.publishedAt}` : '',
            a.snippet ? `   snippet: ${a.snippet.slice(0, 200)}` : '',
          ].filter(Boolean);
          return lines.join('\n');
        })
        .join('\n\n'),
    ].join('\n');

    let output = '';
    try {
      // Cap output + retries so this call has a bounded ceiling and the
      // function doesn't get killed mid-stream. Default SDK retries can
      // double the wall time on flaky 429s; we'd rather fail fast and
      // surface an actionable error.
      const { text } = await generateText({
        model,
        system: REPORT_SYSTEM,
        prompt: userMsg,
        temperature: 0.2,
        maxOutputTokens: 6000,
        maxRetries: 1,
      });
      output = text.trim();
    } catch (err) {
      console.error('[desk] summarize failed', err);
      await refundOnFailure('summarize_failed');
      await patch({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'summarize_failed',
      });
      return;
    }

    await pushAndPatch('보고서 받았어요. 이제 정량 분석 차트를 짜볼게요…', 'summarizing');

    // ── Analytics charts (LLM-derived, content-grounded) ───────────────────
    //
    // Anthropic 조직 한도 = 30k input tokens / minute (Tier 1). summarize
    // 가 방금 같은 분 안에서 큰 입력을 태웠으니, 여기서는 아래 셋을 함께
    // 적용해 두 번째 호출이 윈도우를 못 넘기게 합니다.
    //
    //  1) 프롬프트에서 기사 헤드라인 60개 제거 — 보고서 본문이 이미 인사이트를
    //     포함하고 있어서 차트 설계에는 충분합니다.
    //  2) 보고서 본문도 12k자로 자름 (대략 4~5k tokens) — 더 길어도 차트
    //     생성에 추가 정보가 거의 없습니다.
    //  3) 차트 JSON 출력은 1~2k tokens면 충분하므로 maxOutputTokens 를 명시
    //     해서 SDK 기본값(128k) 이 사용량 추적에 잡히지 않게.
    //  4) summarize 직후 6초 대기. retry-after 헤더 기준 1분 윈도우가 풀리는
    //     데 보통 충분합니다 (한도가 다 안 차면 무해한 sleep).
    let analytics: { charts: { type: 'bar' | 'pie'; title: string; insight: string; unit: 'percent' | 'count'; data: { label: string; value: number }[] }[] } | null = null;
    const analyticsModel = getAnalyticsModel();
    try {
      if (!analyticsModel) {
        throw new Error('missing_openai_key');
      }
      const trimmedReport = output.length > 12_000 ? `${output.slice(0, 12_000)}\n…(생략)` : output;
      const result = await generateObject({
        model: analyticsModel,
        system: ANALYTICS_SYSTEM,
        prompt: [
          `메인 키워드: ${keywords.join(', ')}`,
          `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
          '',
          '--- 직전에 작성한 보고서 ---',
          trimmedReport,
        ].join('\n'),
        schema: AnalyticsSchema,
        temperature: 0.2,
        maxOutputTokens: 4000,
        maxRetries: 1,
      });
      analytics = result.object;
      await pushAndPatch(
        `차트 ${analytics.charts.length}개 만들었어요. 화면에 띄울게요.`,
        'summarizing',
      );
    } catch (err) {
      console.error('[desk] analytics failed', err);
      await pushAndPatch('정량 분석 차트는 못 만들었어요 — 보고서만 띄울게요.', 'summarizing');
    }

    const { data: gen } = await admin
      .from('generations')
      .insert({
        org_id: orgId,
        user_id: userId,
        feature: 'desk',
        input: JSON.stringify({ keywords, sources: usable, locale, range }),
        output,
        credits_spent: FEATURE_COSTS.desk,
      })
      .select('id')
      .single();

    await patch({
      status: 'done',
      output,
      articles: articles as unknown as object,
      analytics: analytics as unknown as object,
      generation_id: gen?.id,
    });
  } catch (err) {
    if (err instanceof CancelledError) {
      await refundOnFailure('cancelled');
      pushEvent('사용자 요청으로 작업을 중단했어요. 차감된 크레딧은 돌려드렸어요.');
      await admin
        .from('desk_jobs')
        .update({
          status: 'cancelled',
          progress: {
            phase: undefined,
            crawl_total: crawlTotal,
            crawl_done: crawlDone,
            events: [...events],
          },
        })
        .eq('id', jobId);
      return;
    }
    console.error('[desk] runJob fatal', err);
    await refundOnFailure('runtime_error');
    await admin
      .from('desk_jobs')
      .update({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'unknown',
      })
      .eq('id', jobId);
  }
}
