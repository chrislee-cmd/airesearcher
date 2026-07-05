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
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

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
  sources: z.array(z.enum(SOURCE_IDS)).min(1).max(MAX_SOURCES),
  locale: z.enum(['ko', 'en']).optional(),
  // 멀티 region 우선. 단일 `region` 도 backward-compat 으로 유지 — 누락 시
  // locale 로 기본값 결정 (기존 동작과 동일).
  regions: z.array(REGION_ENUM).min(1).max(MAX_REGIONS).optional(),
  region: REGION_ENUM.optional(),
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

const EXPAND_SYSTEM = `당신은 데스크 리서치를 위해 사용자가 입력한 키워드의 검색 적합 유사 키워드를 만드는 보조자입니다.
- 의미가 가깝거나 함께 검색되는 변형을 4개 제시합니다.
- 한국어 입력이면 한국어 위주, 영어 입력이면 영어 위주로 작성하되 통용되는 영문/한글 표기는 섞어도 됩니다.
- 결과는 콤마(,)로만 구분된 한 줄로 출력. 따옴표/번호/설명 금지.`;

const REPORT_SYSTEM = `당신은 데스크 리서치 보고서를 작성하는 전문 리서처입니다. 입력으로 키워드, 유사 키워드, 그리고 여러 출처에서 수집한 기사/포스트/영상 헤드라인 + 요약 목록을 받습니다. 입력의 항목 목록은 이미 **UI 카테고리 별로 그룹핑**되어 제공됩니다.

[작성 원칙]
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 본문은 정중한 **존댓말**로 작성합니다 — 모든 서술은 '-입니다 / -합니다 / -하였습니다 / -보입니다 / -로 보입니다' 어미를 사용합니다. 반말('-다', '-한다', '-이다')과 명사형 종결('-함', '-됨')은 금지합니다.
- 사실을 임의로 추가하지 않고 제공된 자료에만 근거합니다. 자료에 없는 수치·날짜·이름은 만들어내지 않습니다.
- 강조는 **굵게** 를 사용할 수 있습니다.

[인용 규칙 — 반드시 준수]
- 모든 링크는 반드시 \`[매체명](URL)\` 형식의 markdown 링크입니다. 절대 raw URL을 본문에 노출하지 않습니다.
- **각 불릿(claim/사실) 옆에는 반드시 inline citation 을 붙입니다.** 인용 없는 서술은 금지합니다.
  - 좋은 예: "삼성전자 2024 Q3 매출 79조원 [매일경제](https://mk.co.kr/...) [연합뉴스](https://yna.co.kr/...)"
  - 나쁜 예: "삼성전자 2024 Q3 매출 79조원" (인용 없음)
- **각 claim 은 가능하면 2개 이상의 출처를 인용**합니다. 자료에 해당 claim 을 뒷받침하는 출처가 1개뿐이면 1개만 인용해도 됩니다 (억지로 무관한 출처를 붙이지 않습니다).
- **primary source 우선**: 공식 통계·공시(DART / KOSIS / 한국은행 ECOS / 산하 연구소 리포트) > 언론 > 커뮤니티 > 학술 논문 순으로 신뢰도를 둡니다. primary source 가 있으면 우선 인용하고, 부족하면 언론·커뮤니티로 보완합니다.
- 매체명은 입력 항목의 \`[매체명]\` 을 그대로 사용합니다.

[필수 출력 구조]
1. \`# 🗞 데스크 리서치 요약\` — 키워드와 수집 기간을 표지에 표기합니다 (한 줄).
2. 그 다음 **아래 5개 카테고리 섹션을 이 순서대로** 작성합니다. 단, **입력 항목 목록에 자료가 있는 카테고리만** heading 을 냅니다 (자료가 0건인 카테고리는 heading 자체를 생략 — 빈 섹션을 만들지 않습니다):
   \`## 📰 뉴스·포털 요약\`
   \`## 💬 커뮤니티 요약\`
   \`## 📊 시장 통계 요약\`
   \`## 🎓 학술·논문 요약\`
   \`## 🏛 산하 연구소 요약\`
   - 각 카테고리 안 = **불릿 리스트 3~8개**. 자료가 많으면 핵심만 압축하고, 적으면 있는 만큼만 작성합니다.
   - 각 불릿 = 하나의 claim/사실 + inline citation. 같은 카테고리 안에서 교차 검증되는 내용은 통합하고, 상충하면 함께 짚습니다.
   - 요청 언어가 영어이면 카테고리 heading 을 영어로 번역하되 이모지는 그대로 둡니다 (예: \`## 📰 News & Portals\`).
3. \`## ⚠️ 한계 / 추가 조사 제안\` — 3~5개 불릿. 데이터 부족 영역, 편향 가능성, 후속 리서치 아이디어를 적습니다 (이 섹션은 인용 없이 작성해도 됩니다).

분량은 충실하게 작성하되 불필요하게 늘리지 않으며, 각 불릿은 의미 있는 정보가 담길 때만 둡니다.${ISOLATION_NOTICE}`;

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

// ── Report category grouping ─────────────────────────────────────────────────
// The synthesizing prompt groups collected articles into the 5 UI categories the
// spec surfaces (뉴스·포털 / 커뮤니티 / 시장 통계 / 학술·논문 / 산하 연구소) so the
// LLM produces one `## <emoji> 카테고리 요약` section per non-empty bucket instead
// of a flat report. The bucket is derived from each source's `category` in
// DESK_SOURCE_REGISTRY (the code SSOT, reused per the source-picker category
// grid) — never re-inferred by the LLM. The registry has two finer categories
// the 5-category UI doesn't surface (`video` = YouTube, `thought` = thought
// leaders); both collapse into `news` (the spec lists YouTube under 뉴스·포털),
// so a new source auto-lands in a sane bucket without touching this map.
type DeskUiCategory = 'news' | 'community' | 'stats' | 'academic' | 'institute';

const UI_CATEGORY_ORDER: DeskUiCategory[] = [
  'news',
  'community',
  'stats',
  'academic',
  'institute',
];

const UI_CATEGORY_HEADING: Record<DeskUiCategory, string> = {
  news: '📰 뉴스·포털',
  community: '💬 커뮤니티',
  stats: '📊 시장 통계',
  academic: '🎓 학술·논문',
  institute: '🏛 산하 연구소',
};

function uiCategoryOf(id: DeskSourceId): DeskUiCategory {
  switch (DESK_SOURCE_REGISTRY[id]?.category) {
    case 'community':
      return 'community';
    case 'stats':
      return 'stats';
    case 'academic':
      return 'academic';
    case 'institute':
      return 'institute';
    // news / video / thought (+ unknown) → 뉴스·포털
    default:
      return 'news';
  }
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
  // even 5 keywords × 12 sources × API latency.
  after(() =>
    runJob({
      jobId: job.id,
      orgId: org.org_id,
      userId: user.id,
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

// Sources that take a region parameter (Google News / GDELT / YouTube). For
// these we crawl once per selected region. Naver/Kakao/Daum are KR-only and
// Reddit/HackerNews are region-agnostic — both are crawled once regardless of
// how many regions the user picked.
const REGION_AWARE_SOURCES = new Set<DeskSourceId>([
  'google_news',
  'gdelt_news',
  'youtube',
]);

// ─── Background runner ───────────────────────────────────────────────────────
async function runJob(args: {
  jobId: string;
  orgId: string;
  userId: string;
  keywords: string[];
  usable: DeskSourceId[];
  locale: 'ko' | 'en';
  regions: DeskRegion[];
  range: DeskDateRange;
  initialEvents: string[];
}) {
  const { jobId, orgId, userId, keywords, usable, locale, regions, range, initialEvents } = args;
  // 단일 region 만 받는 다운스트림 (region-무관 source crawl) 용 representative.
  // 멀티 region 일 때 첫 region 을 대표값으로 — 보고서 본문은 regions 전체
  // 목록을 별도로 받음.
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';
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

    await checkCancel();

    let similar: string[] = [];
    beginPhase('expanding');
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
            providerOptions: ZERO_RETENTION,
            timeout: LLM_TIMEOUT_SHORT_MS,
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
    endPhase('expanding');

    await checkCancel();

    const allKeywords = [...keywords, ...similar];
    // 멀티 region 시 region-aware source (google_news/gdelt/youtube) 는 region
    // 마다 별도 crawl, 나머지 (naver/kakao/reddit/hn) 는 한 번만. 사용자가
    // KR + JP 를 고르면 Google News 가 둘 다 검색됩니다.
    type CrawlTarget = { src: DeskSourceId; region: DeskRegion };
    const targets: CrawlTarget[] = [];
    for (const src of usable) {
      if (REGION_AWARE_SOURCES.has(src)) {
        for (const r of regions) targets.push({ src, region: r });
      } else {
        // primaryRegion 으로 한 번만 — 어차피 source 자체가 region 무관.
        targets.push({ src, region: primaryRegion });
      }
    }

    crawlTotal = allKeywords.length * targets.length;
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
      `이제 ${allKeywords.length}개 키워드 × ${targets.length}개 (소스 × 지역) = ${crawlTotal}회 검색을 동시에 돌릴게요. 키워드당 소스별 ${perKwLimit}건씩 균등 분배합니다. 지역: ${regionLabel}. 소스: ${sourceList}.`,
      'crawling',
    );

    const collected: DeskArticle[] = [];
    const tasks = allKeywords.flatMap((kw) =>
      targets.map(({ src, region }) =>
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
      ),
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

    // Group the sampled articles into the 5 UI categories so the LLM writes one
    // section per non-empty bucket. The bucket comes from the registry category
    // (uiCategoryOf) — pre-computed here, never re-inferred by the model. Each
    // item is tagged with its human 매체명 ([origin] for aggregators like Google
    // News, else the source label) so the model can cite `[매체명](url)` directly.
    const grouped = new Map<DeskUiCategory, typeof articlesForLLM>();
    for (const a of articlesForLLM) {
      const cat = uiCategoryOf(a.source);
      const bucket = grouped.get(cat);
      if (bucket) bucket.push(a);
      else grouped.set(cat, [a]);
    }

    let itemIdx = 0;
    const categoryBlocks = UI_CATEGORY_ORDER.filter(
      (c) => (grouped.get(c)?.length ?? 0) > 0,
    ).map((c) => {
      const items = grouped.get(c) ?? [];
      const body = items
        .map((a) => {
          itemIdx += 1;
          const media = a.origin || sourceLabelKo(a.source);
          const lines = [
            `${itemIdx}. [${media}] ${a.title}`,
            `   url: ${a.url}`,
            a.publishedAt ? `   published: ${a.publishedAt}` : '',
            a.snippet ? `   snippet: ${a.snippet.slice(0, 200)}` : '',
          ].filter(Boolean);
          return lines.join('\n');
        })
        .join('\n\n');
      return `=== ${UI_CATEGORY_HEADING[c]} (${items.length}건) ===\n${body}`;
    });

    const userMsg = [
      `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
      `메인 키워드: ${keywords.join(', ')}`,
      `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
      `검색 지역: ${regions.join(', ')}`,
      `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
      `전체 수집: ${articles.length}건 (이 중 의미가 다양한 ${articlesForLLM.length}건을 본문에 첨부)`,
      '',
      '--- 항목 목록 (카테고리별로 그룹핑됨 — 이 카테고리 순서·구획을 그대로 리포트 heading 으로 사용하세요) ---',
      categoryBlocks.join('\n\n'),
    ].join('\n');

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
        system: REPORT_SYSTEM,
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
