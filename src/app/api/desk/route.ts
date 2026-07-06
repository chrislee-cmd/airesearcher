import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { generateObject, generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { spendCredits, refundCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import {
  crawlSourceWithTimeout,
  dedupeArticles,
  sourceMissingKey,
  SOURCE_BUDGET,
} from '@/lib/desk-crawl';
import { pickRepresentativeArticles } from '@/lib/desk-embed';
import { getCache, hashString, setCache } from '@/lib/cache';
import type { DeskDateRange } from '@/lib/desk-crawl';
import {
  DESK_SOURCE_REGISTRY,
  type DeskArticle,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';
import {
  runOrchestrator,
  NotImplementedYet,
  TREND_SOURCE_IDS,
  type DeskMode,
  type OrchestratorPlan,
} from '@/lib/desk-orchestrator';

export const maxDuration = 300;

// Auto-derived from the source registry — registering a source in
// `registry.ts` is now the *only* step to make it acceptable input. The old
// hard-coded list silently rejected every source added after `kci` (kosis /
// dart / boj_ecos / arxiv / semantic_scholar / institutes_kr), producing a
// `400 invalid_input` the moment a user picked one (2026-07-05 P0 regression).
const SOURCE_IDS = Object.keys(DESK_SOURCE_REGISTRY) as [
  DeskSourceId,
  ...DeskSourceId[],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REGION_ENUM = z.enum(['KR', 'US', 'SG', 'MY', 'TH', 'JP', 'GLOBAL']);

// ── Crawl scope hard caps (spec-down — 2026-06-30 timeout incident) ──────────
// The crawl phase cost scales with keywords × sources × regions. Unbounded it
// reached 211s (70% of the 300s budget) and the report never got generated.
// These caps bound the worst case so the LLM report phase always gets budget.
// Mirrored in the client UI (desk-card-body) for an estimate/warning at input
// time. Keep the three in sync if you change them.
const MAX_KEYWORDS = 5;
// 12 → 25: PR #741 카테고리 grid 는 카테고리 카드 클릭 시 하위 소스 id 를
// 자동 확장한다. 5 카테고리를 모두 켜면 news(5)+community(4)+stats(3)+
// academic(3)+institute(1) ≈ 16-19 소스가 되어 옛 상한 12 를 넘겨 zod 가
// `400 invalid_input` 을 던졌다 (2026-07-05 P0 회귀). 5 카테고리 × 최대 5
// 소스 = 25 로 상향해 여유를 둔다. crawl budget(perKwLimit)은 소스 수와
// 무관하게 SOURCE_BUDGET/키워드로 나뉘므로 300s 예산은 유지된다.
const MAX_SOURCES = 25;
const MAX_REGIONS = 3;

const Body = z.object({
  keywords: z.array(z.string().min(1).max(120)).min(1).max(MAX_KEYWORDS),
  // 리서치 목적 mode (데스크 v2). 누락 시 'custom' — mode 도입 전 클라이언트
  // 요청이 옛 flow(소스 직접 선택) 그대로 동작하는 backward-compat.
  mode: z.enum(['trend', 'market', 'custom']).optional(),
  // custom mode 에서만 필수 (아래 POST 에서 mode 별 검증). trend/market 은
  // 서버가 소스를 자동 선정하므로 client 가 보내지 않는다.
  sources: z.array(z.enum(SOURCE_IDS)).min(1).max(MAX_SOURCES).optional(),
  locale: z.enum(['ko', 'en']).optional(),
  // 멀티 region 우선. 단일 `region` 도 backward-compat 으로 유지 — 누락 시
  // locale 로 기본값 결정 (기존 동작과 동일).
  regions: z.array(REGION_ENUM).min(1).max(MAX_REGIONS).optional(),
  region: REGION_ENUM.optional(),
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const EXPAND_SYSTEM = `
사용자가 입력한 검색 키워드를 데스크 리서치용 6개 검색어로 재구성한다.
원 키워드가 좁거나 결과가 없을 가능성이 높을 때 대비해 다양성 축을 확보한다.

축 배분 (원 키워드 제외 총 6개, 각 축 1-2개):
1. broader (macro): 원보다 상위 범주 — 산업/시장 전체
   예: "스킨케어 회사 시장규모" → "화장품 산업 시장", "뷰티 산업 규모"
2. narrower (specific): 원보다 하위 — 대표 회사/브랜드/제품군 명시
   예: "스킨케어 회사 시장규모" → "아모레퍼시픽 매출", "LG생활건강 화장품 실적"
3. lateral (인접): 원과 다른 각도 — 연구/트렌드/전망 등
   예: "스킨케어 회사 시장규모" → "K-뷰티 수출 동향", "글로벌 화장품 트렌드"

규칙:
- 원 키워드 언어 (한국어/영어) 유지
- 각 검색어 = 명확한 명사구 (질문 X)
- 원 키워드 그대로 반복 X (원과 유사 표현 X)
- 반환 = 쉼표 또는 줄바꿈 구분, 6 개 이내
`.trim();

// 리포트 합성 system prompt + 항목 목록 형식은 mode 소유로 이관됐다 —
// src/lib/desk-orchestrator/{custom,trend}.ts 참고. 이 파일(runner)에는
// mode 무관 공통 프롬프트(키워드 확장 / 차트)만 남는다.


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

function getModel(): LanguageModel {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('missing_anthropic_key');
  return createAnthropic({ apiKey })('claude-sonnet-4-6');
}

// Analytics runs on a separate provider (OpenAI gpt-4o-mini) so its rate
// limit pool doesn't share Anthropic's 30k input tokens/min bucket. The
// long-form report stays on Sonnet for quality; only the structured chart
// extraction moves to OpenAI.
function getAnalyticsModel(): LanguageModel | null {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({ apiKey })('gpt-4o-mini');
}

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCE_REGISTRY[id]?.label ?? id;
}

// Phases that record per-step wall-clock (surfaced as the 4-step timing chips
// in desk-card-body: 키워드 확장 / 크롤 / 요약 / 차트).
type PhaseName = 'expanding' | 'crawling' | 'summarizing' | 'analytics';

type ProgressShape = {
  phase?: 'expanding' | 'crawling' | 'summarizing';
  crawl_total?: number;
  crawl_done?: number;
  events: string[];
  // Per-phase wall-clock (ms). Populated as phases close so the client can
  // show the 4-step timing chips without trawling Vercel logs.
  timings?: Partial<Record<`${PhaseName}_ms`, number>>;
  // Total elapsed since runJob start (ms). Updated on every progress patch.
  elapsed_ms?: number;
  // HARD_DEADLINE_MS used for this run — lets UI surface remaining budget.
  deadline_ms?: number;
  // Steps the safety-net logic intentionally bypassed (raw_dump). Shown in the
  // report footer so users know the run ran tight and a corner was cut.
  skipped_steps?: string[];
};

// Server-side maxDuration is 300s — leave a margin for the final DB writes
// (generations insert + final patch, ~3s). 285s = 15s safety. The report phase
// is the long pole, so a tighter safety margin buys it more budget; the
// analytics skip (< 20s left) guarantees we never start a chart call we can't
// afford, and the final writes always fit the remaining 15s.
const HARD_DEADLINE_MS = 285_000;
// Hard guarantee against a 0-output run (the 2026-06-30 incident). If crawl
// ate so much budget that we can't even afford the report round-trip, skip the
// LLM phases and emit a deterministic raw-data dump (collected articles +
// metadata, 0 LLM calls, written in <1s). The user gets a usable artifact
// instead of `function_timeout_autocleanup`. With the crawl caps + per-task
// timeout this branch should almost never fire, but it is the last safety net.
const RAW_DUMP_AFTER_CRAWL_MS = 110_000;
// Hard per-call LLM timeouts — without these the AI SDK can hang forever on a
// network stall or stuck provider (2026-06-30 incident hardening).
const LLM_TIMEOUT_SHORT_MS = 30_000; // expanding / analytics
// Report synthesis floor. The actual cap is deadline-aware (timeLeft minus a
// small reserve for analytics + DB writes) so a legit 6000-token report — which
// can run 100~140s — gets the remaining function budget instead of a fixed cap
// cutting it off mid-stream (the pre-#380 pipeline relied on the 300s ceiling
// with no per-call cap). A genuinely hung provider still aborts + refunds.
const LLM_TIMEOUT_SUMMARIZE_FLOOR_MS = 90_000;
// Reserve held back from the report's budget for DB writes (analytics is
// best-effort and self-skips below SKIP_ANALYTICS_BELOW_MS).
const SUMMARIZE_RESERVE_MS = 15_000;
// Below this remaining budget after the report, skip charts so the report
// itself always gets saved (charts are a visual nice-to-have, not the artifact).
const SKIP_ANALYTICS_BELOW_MS = 20_000;

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
  const { keywords, sources, locale = 'ko', regions: regionsInput, region: regionInput, dateFrom, dateTo, project_id } = parsed.data;
  const mode: DeskMode = parsed.data.mode ?? 'custom';
  // Default region from locale: Korean researchers default to KR sources,
  // English researchers default to GLOBAL (Google News will use US/en).
  // 멀티 region 입력이 있으면 그대로, 아니면 단일 region (legacy) 또는 locale
  // 기본값. 중복은 Set 으로 정리.
  const regions: DeskRegion[] = Array.from(
    new Set<DeskRegion>(
      regionsInput && regionsInput.length > 0
        ? regionsInput
        : [regionInput ?? (locale === 'ko' ? 'KR' : 'GLOBAL')],
    ),
  );
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 });
  }

  const cleanKeywords = Array.from(
    new Set(keywords.map((k) => k.trim()).filter(Boolean)),
  ).slice(0, MAX_KEYWORDS);
  if (cleanKeywords.length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  }

  // mode 별 소스 결정 — custom 은 사용자 선택(필수), trend 는 서버 자동 선정
  // (뉴스·SNS·검색량 위주), market 은 후속 PR 에서 resolve (지금은 빈 목록 —
  // runner 의 NotImplementedYet 가드가 크레딧 환불과 함께 최종 처리).
  let requestedSources: DeskSourceId[];
  if (mode === 'custom') {
    if (!sources || sources.length === 0) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    requestedSources = sources as DeskSourceId[];
  } else if (mode === 'trend') {
    requestedSources = TREND_SOURCE_IDS;
  } else {
    requestedSources = [];
  }

  const skipped: { source: DeskSourceId; missing: string }[] = [];
  const usable: DeskSourceId[] = [];
  for (const s of requestedSources) {
    const missing = sourceMissingKey(s);
    if (missing) skipped.push({ source: s, missing });
    else usable.push(s);
  }
  if (usable.length === 0 && mode !== 'market') {
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
      mode,
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
  // even 5 keywords × 12 sources × API latency.
  after(() =>
    runJob({
      jobId: job.id,
      orgId: org.org_id,
      userId: user.id,
      mode,
      keywords: cleanKeywords,
      usable,
      locale,
      regions,
      range: { from: dateFrom, to: dateTo },
      initialEvents,
    }),
  );

  return NextResponse.json({ job_id: job.id });
}

// ─── Background runner ───────────────────────────────────────────────────────
// mode 무관 공통 파이프라인 (확장 → crawl → 안전망 → 샘플링 → 리포트 → 차트
// → 저장). mode 별 결정(소스/crawl task/판단 로그/리포트 prompt)은 orchestrator
// plan (src/lib/desk-orchestrator) 이 소유 — 후속 mode PR 은 이 파일을 재편집
// 하지 않는다.
async function runJob(args: {
  jobId: string;
  orgId: string;
  userId: string;
  mode: DeskMode;
  keywords: string[];
  usable: DeskSourceId[];
  locale: 'ko' | 'en';
  regions: DeskRegion[];
  range: DeskDateRange;
  initialEvents: string[];
}) {
  const { jobId, orgId, userId, mode, keywords, usable, locale, regions, range, initialEvents } = args;
  const admin = createAdminClient();
  const events: string[] = [...initialEvents];
  let crawlDone = 0;
  let crawlTotal = 0;

  // ── Deadline + per-phase timing ─────────────────────────────────────────
  // Single source of truth for wall-clock budget. timeLeft() drives the
  // raw-dump safety net so a 0-output run is impossible; timings keeps a
  // breakdown that survives the function exit (stored in progress JSON) and
  // feeds the client's 4-step timing chips.
  const startTime = Date.now();
  const timings: Partial<Record<`${PhaseName}_ms`, number>> = {};
  const phaseStart: Partial<Record<PhaseName, number>> = {};
  const skippedSteps: string[] = [];
  const timeLeft = () => HARD_DEADLINE_MS - (Date.now() - startTime);
  const elapsedMs = () => Date.now() - startTime;
  function beginPhase(name: PhaseName) {
    phaseStart[name] = Date.now();
  }
  function endPhase(name: PhaseName) {
    const start = phaseStart[name];
    if (start) {
      timings[`${name}_ms`] = Date.now() - start;
      delete phaseStart[name];
    }
  }

  type Patch = Partial<{
    status: 'queued' | 'expanding' | 'crawling' | 'summarizing' | 'done' | 'error';
    progress: ProgressShape;
    similar_keywords: string[];
    output: string;
    articles: unknown;
    analytics: unknown;
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
        timings: { ...timings },
        elapsed_ms: elapsedMs(),
        deadline_ms: HARD_DEADLINE_MS,
        skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
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

    // mode 별 실행 계획 — 소스/crawl task/판단 로그/리포트 prompt 의 SSOT.
    // market 은 아직 stub 이라 여기서 NotImplementedYet 를 던진다 (LLM 호출 0
    // 시점 = 확장 전). 크레딧 환불 + 구분 가능한 에러 코드로 마무리.
    let plan: OrchestratorPlan;
    try {
      plan = await runOrchestrator(mode, {
        keywords,
        usableSources: usable,
        locale,
        regions,
        range,
      });
    } catch (err) {
      if (err instanceof NotImplementedYet) {
        await refundOnFailure('not_implemented_yet');
        await patch({ status: 'error', error_message: err.message });
        return;
      }
      throw err;
    }

    await checkCancel();

    let similar: string[] = [];
    beginPhase('expanding');
    if (keywords.length === 1) {
      await patch({ status: 'expanding' });
      await pushAndPatch(
        '한 키워드라 비슷한 표현도 같이 찾으면 더 풍부하겠어요. AI한테 6개 더 받아올게요…',
        'expanding',
      );
      // Same keyword + locale always yields the same suggestions (modulo
      // model/temperature drift, which we accept). Cache cross-org/cross-user
      // because the output isn't user-specific. Bump 'v2' if EXPAND_SYSTEM
      // changes meaningfully.
      const expandKey = `desk-expand:v2:${locale}:${hashString(keywords[0].trim().toLowerCase())}`;
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
            providerOptions: ZERO_RETENTION,
            timeout: LLM_TIMEOUT_SHORT_MS,
          });
          similar = text
            .trim()
            .split(/[,\n]/)
            .map((s) => s.trim().replace(/^["'`]+|["'`]+$/g, ''))
            .filter(Boolean)
            .filter((k) => k.toLowerCase() !== keywords[0].toLowerCase())
            .slice(0, 6);
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
    endPhase('expanding');

    await checkCancel();

    // AI 판단 로그 — mode plan 이 만든 판단 근거(소스 선정 / 축 설계 / 제외
    // 사유)를 crawl 시작 전에 이벤트로 push. 보고서 상단 AiJudgmentLog 가
    // 마커(🎯🔍🧠📰🚫)로 이 라인들만 골라 렌더한다. custom 은 아직 0줄.
    const judgmentLines = plan.buildJudgmentEvents({ similar });
    if (judgmentLines.length > 0) {
      for (const line of judgmentLines.slice(0, -1)) pushEvent(line);
      await pushAndPatch(judgmentLines[judgmentLines.length - 1], 'expanding');
    }

    const allKeywords = [...keywords, ...similar];
    // crawl task 구성은 mode plan 소유 — custom 은 옛 (키워드 × 소스 × region)
    // 조합 그대로, trend 는 부정 신호 filter 조합이 추가된다.
    const crawlTasks = plan.buildCrawlTasks({ similar });
    crawlTotal = crawlTasks.length;
    await patch({ status: 'crawling' });
    beginPhase('crawling');
    // Split each source's budget evenly across keywords. Without this, the
    // first keyword's pull races to the source's full 500 cap and rate-limits
    // / latency starve the later keywords. ceil() means small budgets still
    // give every keyword at least 1 slot.
    const perKwLimit = Math.max(
      1,
      Math.ceil(SOURCE_BUDGET / Math.max(allKeywords.length, 1)),
    );
    const sourceList = Array.from(new Set(usable.map(sourceLabelKo))).join(', ');
    const regionLabel = regions.join(', ');
    await pushAndPatch(
      `이제 키워드 ${allKeywords.length}개 기준 총 ${crawlTotal}회 검색을 동시에 돌릴게요. 키워드당 소스별 ${perKwLimit}건씩 균등 분배합니다. 지역: ${regionLabel}. 소스: ${sourceList}.`,
      'crawling',
    );

    const collected: DeskArticle[] = [];
    const tasks = crawlTasks.map(({ source: src, keyword: kw, region }) =>
      // Per-task hard timeout — a single hung/deep-paginating source can no
      // longer balloon the whole crawl phase (2026-06-30 incident root cause).
      crawlSourceWithTimeout(src, kw, region, range, perKwLimit)
        .then(async (items) => {
          crawlDone += 1;
          collected.push(...items);
          await pushAndPatch(
            `${sourceLabelKo(src)} (${region}) · ‘${kw}’ — ${items.length}건 가져왔어요. (${crawlDone}/${crawlTotal})`,
            'crawling',
          );
        })
        .catch(async (err) => {
          crawlDone += 1;
          await pushAndPatch(
            `${sourceLabelKo(src)} (${region}) · ‘${kw}’ — 실패했어요 (${err instanceof Error ? err.message : 'unknown'}).`,
            'crawling',
          );
        }),
    );
    await Promise.all(tasks);
    await checkCancel();

    // Now that per-source pulls aim at 500, the dedupe pool can balloon to
    // a few thousand. Keep a generous global cap so the LLM still gets fed,
    // but bounded enough to fit the model context.
    const articles = dedupeArticles(collected).slice(0, 1500);
    endPhase('crawling');
    await pushAndPatch(
      `수집 끝났습니다. 중복 정리하고 ${articles.length}건으로 추렸어요. (수집 ${Math.round((timings.crawling_ms ?? 0) / 1000)}초)`,
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
          input: JSON.stringify({ mode, keywords, sources: usable, locale, range }),
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

    // ── Emergency raw-data dump (산출물 100% 보장) ─────────────────────────
    // Deterministic markdown built from collected articles + metadata only —
    // zero LLM calls, so it writes in <1s no matter how little budget is left.
    // This is the floor that makes a 0-output run impossible: if the crawl ate
    // the budget (the incident scenario), we hand back the raw sources instead
    // of dying mid-LLM-call. The report opens with a marker the client detects
    // to show the "AI 분석 미완료 — 재시도" banner.
    function buildRawDumpReport(): string {
      const lines: string[] = [];
      lines.push('# 📊 데스크 리서치 결과 — Raw Data');
      lines.push('');
      lines.push(
        '> ⚠️ 시간 제약으로 AI 분석을 완료하지 못했습니다. 수집된 원자료를 그대로 제공합니다. 차감된 크레딧은 자동으로 환불되었습니다.',
      );
      lines.push('');
      lines.push('## 메타데이터');
      lines.push(`- **키워드**: ${keywords.join(', ')}${similar.length ? ` (유사: ${similar.join(', ')})` : ''}`);
      lines.push(`- **지역**: ${regions.join(', ')}`);
      lines.push(
        `- **기간**: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      );
      lines.push(`- **수집**: ${articles.length}건`);
      lines.push('');
      lines.push(`## 수집된 원자료 (${articles.length})`);
      for (const a of articles.slice(0, 300)) {
        lines.push(`- [${a.title}](${a.url}) — ${a.source}${a.publishedAt ? ` · ${a.publishedAt}` : ''}`);
      }
      if (articles.length > 300) lines.push(`_(나머지 ${articles.length - 300}건 생략)_`);
      lines.push('');
      lines.push(
        '---',
        '**보완 안내**: AI 분석(요약 보고서)이 미완료입니다. 더 나은 결과를 원하시면 키워드를 좁히거나(예: 3개 이하) 지역/소스 수를 줄여 재실행하세요.',
      );
      return lines.join('\n');
    }

    if (timeLeft() < RAW_DUMP_AFTER_CRAWL_MS) {
      skippedSteps.push('raw_dump');
      const output = buildRawDumpReport();
      await refundOnFailure('raw_dump_budget');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — AI 분석 단계를 돌리기에 부족해, 수집한 원자료를 그대로 보고서로 드릴게요. 차감된 크레딧은 돌려드렸습니다.`,
        'summarizing',
      );
      const { data: gen } = await admin
        .from('generations')
        .insert({
          org_id: orgId,
          user_id: userId,
          feature: 'desk',
          input: JSON.stringify({ mode, keywords, sources: usable, locale, range }),
          output,
          credits_spent: FEATURE_COSTS.desk,
        })
        .select('id')
        .single();
      await patch({
        status: 'done',
        output,
        articles: articles as unknown as object,
        generation_id: gen?.id,
        progress: {
          phase: 'summarizing',
          crawl_total: crawlTotal,
          crawl_done: crawlDone,
          events: [...events],
          timings: { ...timings },
          elapsed_ms: elapsedMs(),
          deadline_ms: HARD_DEADLINE_MS,
          skipped_steps: [...skippedSteps],
        },
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
    beginPhase('summarizing');

    // ── Sample down to a representative subset for the LLM ──────────────
    // Anthropic Tier 1 한도 = 30k input tokens / min. 1500건 풀을 그대로 보내면
    // 단일 호출에 ~300k tokens 가 필요해 즉시 429. 임베딩 클러스터링으로
    // 의미적으로 다양한 50건만 추려서 보냄. 실패 시 키워드/소스 균등 fallback.
    // UI/DB 에는 1500 풀 그대로 저장됨.
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
          `의미 분석은 실패했지만 ${SUMMARIZE_SAMPLE_K}건으로 줄여서 진행할게요.`,
          'summarizing',
        );
      }
    }

    await pushAndPatch(
      '이제 Claude한테 한 편의 데스크 리서치 보고서로 묶어 달라고 요청할게요…',
      'summarizing',
    );

    // 리포트 합성 입력은 mode plan 소유 — custom 은 5 카테고리 그룹핑
    // (옛 형식 그대로), trend 는 일반 수집 / 부정 신호 filter 2 구획.
    const userMsg = plan.buildReportUserMsg({
      locale,
      keywords,
      similar,
      regions,
      range,
      articles,
      sampled: articlesForLLM,
    });

    // Deadline-aware cap: give the report nearly all remaining function budget
    // (reserve ~15s for the chart call + DB writes) instead of a fixed ceiling.
    // Floors at 90s so a tight-but-viable run still attempts a report.
    const summarizeTimeoutMs = Math.max(
      LLM_TIMEOUT_SUMMARIZE_FLOOR_MS,
      timeLeft() - SUMMARIZE_RESERVE_MS,
    );

    let output = '';
    try {
      // Cap output + retries so this call has a bounded ceiling and the
      // function doesn't get killed mid-stream. Default SDK retries can
      // double the wall time on flaky 429s; we'd rather fail fast and
      // surface an actionable error. Deadline-aware timeout guards against a
      // hung provider while letting a full-length report finish.
      const { text } = await generateText({
        model,
        system: plan.reportSystem,
        prompt: userMsg,
        temperature: 0.2,
        maxOutputTokens: 6000,
        maxRetries: 1,
        providerOptions: ZERO_RETENTION,
        timeout: summarizeTimeoutMs,
      });
      output = text.trim();
    } catch (err) {
      endPhase('summarizing');
      console.error('[desk] summarize failed', err);
      await refundOnFailure('summarize_failed');
      // A timed-out abort (heavy crawl ate the budget) surfaces as a friendly
      // "시간 초과 — 범위를 좁혀 재시도" banner client-side (budget_exceeded_*),
      // not the raw English AbortSignal message.
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message));
      await patch({
        status: 'error',
        error_message: isTimeout
          ? 'budget_exceeded_summarize'
          : err instanceof Error
            ? err.message
            : 'summarize_failed',
      });
      return;
    }
    endPhase('summarizing');

    await pushAndPatch('보고서 받았어요. 이제 정량 분석 차트를 짜볼게요…', 'summarizing');

    // ── Analytics charts (LLM-derived, content-grounded) ───────────────────
    //
    // Anthropic 조직 한도 = 30k input tokens / minute (Tier 1). summarize
    // 가 방금 같은 분 안에서 큰 입력을 태웠으니, 차트는 별도 provider
    // (OpenAI gpt-4o-mini) 로 돌려 Anthropic 윈도우를 안 건드립니다. 보고서
    // 본문은 12k자로 잘라 입력으로 넣고, 출력 토큰도 4k 로 제한합니다.
    let analytics: { charts: { type: 'bar' | 'pie'; title: string; insight: string; unit: 'percent' | 'count'; data: { label: string; value: number }[] }[] } | null = null;
    const analyticsModel = getAnalyticsModel();
    if (timeLeft() < SKIP_ANALYTICS_BELOW_MS) {
      // Report is already written + about to be saved — don't risk the function
      // deadline on charts. They're a visual aid, not the deliverable.
      skippedSteps.push('analytics');
      await pushAndPatch(
        `남은 시간 ${Math.round(timeLeft() / 1000)}초 — 보고서 저장을 우선해서 차트는 생략할게요.`,
        'summarizing',
      );
    } else {
      beginPhase('analytics');
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
          providerOptions: ZERO_RETENTION,
          timeout: LLM_TIMEOUT_SHORT_MS,
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
      endPhase('analytics');
    }

    const { data: gen } = await admin
      .from('generations')
      .insert({
        org_id: orgId,
        user_id: userId,
        feature: 'desk',
        input: JSON.stringify({ mode, keywords, sources: usable, locale, range }),
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
      progress: {
        phase: 'summarizing',
        crawl_total: crawlTotal,
        crawl_done: crawlDone,
        events: [...events],
        timings: { ...timings },
        elapsed_ms: elapsedMs(),
        deadline_ms: HARD_DEADLINE_MS,
        skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
      },
    });
  } catch (err) {
    // Close any phase that was still open when the throw fired so the
    // partial timing shows where we died.
    for (const k of Object.keys(phaseStart) as PhaseName[]) endPhase(k);

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
            timings: { ...timings },
            elapsed_ms: elapsedMs(),
            deadline_ms: HARD_DEADLINE_MS,
            skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
          },
        })
        .eq('id', jobId);
      return;
    }
    console.error('[desk] runJob fatal', err);
    await refundOnFailure('runtime_error');
    pushEvent(
      `오류로 작업이 중단되었어요 (${err instanceof Error ? err.message : 'unknown'}). 크레딧은 돌려드렸어요.`,
    );
    await admin
      .from('desk_jobs')
      .update({
        status: 'error',
        error_message: err instanceof Error ? err.message : 'unknown',
        progress: {
          phase: undefined,
          crawl_total: crawlTotal,
          crawl_done: crawlDone,
          events: [...events],
          timings: { ...timings },
          elapsed_ms: elapsedMs(),
          deadline_ms: HARD_DEADLINE_MS,
          skipped_steps: skippedSteps.length ? [...skippedSteps] : undefined,
        },
      })
      .eq('id', jobId);
  }
}
