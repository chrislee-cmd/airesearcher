// SEC EDGAR 재무 추출 정규화 — XBRL 표준 태그(us-gaap concept) 1순위 + 라벨 alias
// 2순위 + LLM concept-선택 fallback 3순위. **DART 의 `dart-financials.ts` 완벽한
// 등가**다(#456 미러): companyfacts API 가 재무를 XBRL 표준 태그로 구조화 반환하므로,
// 회사마다 흔들리는 표시 라벨이 아니라 **us-gaap concept 키로 지표를 잡는다**.
//
// 왜 이 정규화가 필요한가: 매출 하나만 봐도 회사·연도별로 태그가 다르다 —
// 신규(2018+) 회사는 `RevenueFromContractWithCustomerExcludingAssessedTax`, 구
// 회사는 `Revenues` 또는 `SalesRevenueNet`. 표시 라벨("Net sales" / "Total
// revenues")도 흔들린다. 표준 태그를 1순위 키로 잡으면 이 변동을 근본 해결한다.
//
// 정책 근간(DART 와 동일): **공시된 명시 값만 옮긴다**(LLM 생성/추정 금지). LLM
// fallback 은 이미 응답에 있는 concept 중 어느 것이 그 지표인지 "선택"만 하며 숫자를
// 만들지 않는다. 모든 함수는 실패 시 throw 하지 않고 사유를 담아 degrade 한다.
// server 전용 모듈 — sec-edgar.ts 만 import.

import { z } from 'zod';
import { getCache, setCache } from '@/lib/cache';
import { formatUsd } from '@/lib/global-macro/normalize';
import { secFetch } from './sec-edgar-common';

// ⚠️ dart-financials.ts 와 같은 이유로 이 모듈은 registry 를 거쳐 클라이언트 번들에
// 도달 가능하다. LLM 관련 import(ai/anthropic/llm-config)는 tier-3 fallback 함수 안에서
// **동적 import** 한다(서버 호출 시점에만 평가). env proxy 의 static import 는 안전.

// ── 핵심 지표 세트 (#456 미러 — 6개. 확장은 METRIC_MAP 에 추가만) ──
export type SecMetricKey =
  | 'revenue'
  | 'operatingProfit'
  | 'netIncome'
  | 'totalAssets'
  | 'totalLiabilities'
  | 'totalEquity';

// 지표별 3층 정규화 규칙. usGaapTags=1순위 XBRL concept 키(우선순위 순 — 신규
// taxonomy 를 앞에), aliases=2순위 표시 라벨(소문자·공백정규화 후 정확 일치),
// flow=손익 흐름(기간) 지표 여부(true=duration, false=instant 잔액).
type SecMetricSpec = {
  key: SecMetricKey;
  labelKo: string;
  labelEn: string;
  flow: boolean;
  usGaapTags: readonly string[];
  aliases: readonly string[];
};

// concept 키는 대소문자 그대로 두고(정확 일치는 lower 비교), 우선순위 순으로 나열.
// 총액 지표만 넣는다 — 지배주주지분(NetIncomeLossAvailableToCommonStockholders 등)
// 같은 부분항목은 절대 넣지 않는다.
export const SEC_METRIC_MAP: readonly SecMetricSpec[] = [
  {
    key: 'revenue',
    labelKo: '매출',
    labelEn: 'Revenue',
    flow: true,
    usGaapTags: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ],
    aliases: ['revenue', 'revenues', 'netsales', 'totalrevenues', 'totalnetsales', 'sales'],
  },
  {
    key: 'operatingProfit',
    labelKo: '영업이익',
    labelEn: 'Operating income',
    flow: true,
    usGaapTags: ['OperatingIncomeLoss'],
    aliases: ['operatingincome', 'operatingincomeloss', 'incomefromoperations'],
  },
  {
    key: 'netIncome',
    labelKo: '순이익',
    labelEn: 'Net income',
    flow: true,
    usGaapTags: ['NetIncomeLoss', 'ProfitLoss'],
    aliases: ['netincome', 'netincomeloss', 'netearnings', 'profitloss'],
  },
  {
    key: 'totalAssets',
    labelKo: '자산총계',
    labelEn: 'Total assets',
    flow: false,
    usGaapTags: ['Assets'],
    aliases: ['totalassets', 'assets'],
  },
  {
    key: 'totalLiabilities',
    labelKo: '부채총계',
    labelEn: 'Total liabilities',
    flow: false,
    usGaapTags: ['Liabilities'],
    aliases: ['totalliabilities', 'liabilities'],
  },
  {
    key: 'totalEquity',
    labelKo: '자본총계',
    labelEn: 'Total equity',
    flow: false,
    // StockholdersEquity(지배지분) 우선, 없으면 비지배 포함 총자본.
    usGaapTags: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ],
    aliases: ['totalstockholdersequity', 'stockholdersequity', 'totalequity'],
  },
];

// ── 실패 사유(조용한 null 대체 — DART 와 동일) ──
//   timeout   = companyfacts 응답이 안 와 abort
//   no_report = CIK 없음(404) / 재무 fact 자체가 없음 = 근거 부재
//   api_error = 403(UA 누락)·429(rate limit)·5xx 등 API 레벨 오류
export type SecFinancialsFailReason = 'timeout' | 'no_report' | 'api_error';

// 한 지표의 한 회계연도(FY) 값.
//   year   = 회계연도(period end 날짜에서 도출 — 아래 fiscalYearOf 주석).
//   amount = USD 금액(원 단위). 그 연도 값이 응답에 없으면 null.
//   form   = 값의 출처 공시 양식(10-K / 20-F 등) — 표시/검증용.
export type SecPeriodValue = {
  year: number;
  amount: number | null;
  form: string;
};

export type SecMetric = {
  key: SecMetricKey;
  labelKo: string;
  labelEn: string;
  amount: number; // 최신 FY 값 (periods[0].amount 와 동일).
  periods: SecPeriodValue[]; // 최신 3개년(내림차순, 결측 연도 amount=null).
  // 실제 선택된 us-gaap concept 키(표시·디버그용).
  tag: string;
  // 어느 층에서 매칭됐는지 (1=XBRL 태그, 2=라벨 alias, 3=LLM 선택).
  tier: 1 | 2 | 3;
};

// YOY(전년比, %) = (당기 − 전기) / 전기 × 100 을 **코드에서 결정론적으로** 계산
// (#457 미러 — 정책: LLM 계산 금지, 두 값 모두 cited 라 산술은 안전). 계산 불가
// (결측 / 전기 ≤ 0 손실기저)면 null → 표에서 "—".
export function secYoyPct(cur: SecPeriodValue, prev: SecPeriodValue): number | null {
  if (cur.amount === null || prev.amount === null) return null;
  if (prev.amount <= 0) return null;
  return ((cur.amount - prev.amount) / prev.amount) * 100;
}

export type SecFinancials = {
  cik: string;
  entityName: string;
  fiscalYear: number; // 최신 확보 회계연도
  periodLabel: string; // "FY2023"
  metrics: SecMetric[];
};

export type SecFinancialsResult =
  | { ok: true; financials: SecFinancials }
  | { ok: false; reason: SecFinancialsFailReason };

// companyfacts 응답 shape (필요 필드만). facts["us-gaap"][concept].units["USD"] 이
// 관측치 배열. 통화별 units 가 있고(USD / USD/shares / shares …) 우린 USD 만 읽는다.
type FactUnitRow = {
  start?: string; // duration 시작(YYYY-MM-DD) — flow 지표에만 존재
  end?: string; // 기간 끝 / instant 잔액일
  val?: number;
  fy?: number;
  fp?: string; // FY / Q1 / Q2 / Q3
  form?: string; // 10-K / 10-K/A / 20-F / 40-F / 10-Q …
  filed?: string; // 공시 접수일(YYYY-MM-DD) — 재작성 시 최신 우선
  frame?: string;
};
type Concept = { label?: string; units?: Record<string, FactUnitRow[]> };
type CompanyFacts = {
  entityName?: string;
  facts?: { 'us-gaap'?: Record<string, Concept> };
};

// 연간 보고서 양식만(분기 10-Q 제외). 미국 국내 10-K + 외국 발행사 20-F/40-F.
function isAnnualForm(form: string | undefined): boolean {
  return /^(10-K|20-F|40-F)/.test(form ?? '');
}

// period end 날짜 → 회계연도 번호. 미국 회계연도 관례상 회계연도 종료월이
// 하반기(6~12월)면 그 해 연도로, 연초(1~2월, 소매 52/53주 마감)면 전년으로 라벨한다.
// Apple(9월말)→FY2023, MS(6월말)→FY2023, Nike(5월말)→FY2023, 소매(1월말 2024)→FY2023,
// 캘린더(12월말)→그 해. companyfacts 의 `fy` 필드는 "보고서의 회계연도"라 같은 10-K
// 안의 전년 비교치도 당해 fy 를 달고 나와 신뢰 불가 → end 날짜에서 결정론적으로 도출.
function fiscalYearOf(end: string): number | null {
  const m = /^(\d{4})-(\d{2})-/.exec(end);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month <= 2 ? year - 1 : year;
}

function durationDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return (b - a) / 86_400_000;
}

// 한 concept 의 USD 관측치 → 회계연도별 연간 값 맵. flow(duration)는 연간
// 전체기간(~365일, fp=FY) 관측만, stock(instant)은 회계연도말 잔액(fp=FY) 관측만
// 남긴다. 같은 FY 에 여러 공시(원공시+재작성)가 있으면 **최신 filed** 를 취한다.
function annualByFiscalYear(
  rows: FactUnitRow[],
  flow: boolean,
): Map<number, { amount: number; form: string; filed: string }> {
  const best = new Map<number, { amount: number; form: string; filed: string }>();
  for (const r of rows) {
    if (!isAnnualForm(r.form)) continue;
    if (r.fp !== 'FY') continue; // 연간 컨텍스트만(분기 fp=Q* 배제)
    if (typeof r.val !== 'number' || !r.end) continue;
    if (flow) {
      // duration 지표: 시작·끝이 있고 ~1년(330~400일)인 전체기간만. 전환/스텁
      // 기간이나 분기 누적(≈90/270일)을 배제해 연간끼리만 견주게 한다.
      if (!r.start) continue;
      const d = durationDays(r.start, r.end);
      if (!(d >= 330 && d <= 400)) continue;
    }
    const fy = fiscalYearOf(r.end);
    if (fy === null) continue;
    const filed = r.filed ?? '';
    const prev = best.get(fy);
    if (!prev || filed > prev.filed) {
      best.set(fy, { amount: r.val, form: r.form ?? '', filed });
    }
  }
  return best;
}

// 최신 FY 기준 3개년 시계열을 만든다. baseYear=맵의 최대 FY. 결측 연도는 amount=null.
function buildPeriods(
  byFy: Map<number, { amount: number; form: string; filed: string }>,
): SecPeriodValue[] | null {
  if (!byFy.size) return null;
  const baseYear = Math.max(...byFy.keys());
  const periods: SecPeriodValue[] = [];
  for (let y = baseYear; y >= baseYear - 2; y--) {
    const hit = byFy.get(y);
    periods.push({ year: y, amount: hit ? hit.amount : null, form: hit ? hit.form : '' });
  }
  return periods;
}

// 한 concept → SecMetric(3개년). 최신 FY 값이 없으면(전부 결측) null.
function metricFromConcept(
  spec: SecMetricSpec,
  concept: Concept,
  tag: string,
  tier: 1 | 2 | 3,
): SecMetric | null {
  const usd = concept.units?.USD;
  if (!Array.isArray(usd) || !usd.length) return null;
  const byFy = annualByFiscalYear(usd, spec.flow);
  const periods = buildPeriods(byFy);
  if (!periods || periods[0].amount === null) return null; // 최신 FY 결측 = 근거 부재
  return {
    key: spec.key,
    labelKo: spec.labelKo,
    labelEn: spec.labelEn,
    amount: periods[0].amount,
    periods,
    tag,
    tier,
  };
}

function normLabel(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 한 지표를 tier-1(us-gaap 태그)/tier-2(라벨 alias)로 뽑는다. usGaap = concept 맵.
function matchMetric(
  usGaap: Record<string, Concept>,
  spec: SecMetricSpec,
): SecMetric | null {
  // tier-1: us-gaap concept 키 정확 일치(우선순위 순 — 첫 성공 태그로 확정).
  const lowerKeyMap = new Map<string, string>();
  for (const k of Object.keys(usGaap)) lowerKeyMap.set(k.toLowerCase(), k);
  for (const tag of spec.usGaapTags) {
    const realKey = lowerKeyMap.get(tag.toLowerCase());
    if (!realKey) continue;
    const m = metricFromConcept(spec, usGaap[realKey], realKey, 1);
    if (m) return m;
  }
  // tier-2: 표시 라벨 정규화 후 정확 일치.
  for (const [key, concept] of Object.entries(usGaap)) {
    if (spec.aliases.includes(normLabel(concept.label))) {
      const m = metricFromConcept(spec, concept, key, 2);
      if (m) return m;
    }
  }
  return null;
}

// ── companyfacts 조회 + 캐시 (DART fetchDartFinancials 미러) ──
// companyfacts payload 는 크다(Apple ~수 MB). crawl task 15s 벽 안에서 매번 받으면
// timeout 위험이 커, 성공 결과(추출된 SecFinancials, 작음)만 Supabase 캐시에 실어
// orchestrator warm-up(task cap 밖)이 미리 채운다 → 각 crawl task 는 캐시 히트.
// 월 버킷 — 새 10-K 가 공시되면 한 달 내 자동 갱신.
const FIN_CACHE_VERSION = 'v1';
function finCacheKey(cik: string): string {
  const now = new Date();
  const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `sec:fin:${FIN_CACHE_VERSION}:${cik}:${bucket}`;
}

const CRAWL_TIMEOUT_MS = 6_000; // crawl task 안 — 캐시 히트가 정상, 라이브는 짧게.
const LLM_MIN_BUDGET_MS = 4_000;

type SecFetchOpts = { timeoutMs?: number; allowLlm?: boolean };

export async function fetchSecFinancials(
  cik: string,
  entityName: string,
  opts: SecFetchOpts = {},
): Promise<SecFinancialsResult> {
  const timeoutMs = opts.timeoutMs ?? CRAWL_TIMEOUT_MS;

  // 캐시 히트 = 원거리 왕복·timeout 위험 0. 성공 결과만 캐시한다.
  const cacheKey = finCacheKey(cik);
  try {
    const cached = await getCache<SecFinancials>(cacheKey);
    if (cached && Array.isArray(cached.metrics) && cached.metrics.length) {
      return { ok: true, financials: cached };
    }
  } catch {
    // 캐시 조회 실패는 무시하고 라이브 조회로 진행.
  }

  let facts: CompanyFacts;
  try {
    const res = await secFetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      timeoutMs,
    );
    if (res.status === 404) return { ok: false, reason: 'no_report' };
    if (!res.ok) return { ok: false, reason: 'api_error' };
    facts = (await res.json()) as CompanyFacts;
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    return { ok: false, reason: aborted ? 'timeout' : 'api_error' };
  }

  const usGaap = facts.facts?.['us-gaap'];
  if (!usGaap || typeof usGaap !== 'object') return { ok: false, reason: 'no_report' };

  // tier-1/2 추출.
  const metrics: SecMetric[] = [];
  const unmapped: SecMetricSpec[] = [];
  for (const spec of SEC_METRIC_MAP) {
    const hit = matchMetric(usGaap, spec);
    if (hit) metrics.push(hit);
    else unmapped.push(spec);
  }

  // tier-3 LLM concept-선택 fallback — tier-1/2 가 놓친 극소수 지표만, 예산 넉넉·
  // 활성 시. 이미 응답에 있는 concept 중 선택만 하며 숫자를 만들지 않는다.
  if (unmapped.length && opts.allowLlm && timeoutMs >= LLM_MIN_BUDGET_MS) {
    const picked = await llmSelectConcepts(usGaap, unmapped, LLM_MIN_BUDGET_MS - 500);
    for (const m of picked) {
      metrics.push(m);
      const i = unmapped.findIndex((s) => s.key === m.key);
      if (i >= 0) unmapped.splice(i, 1);
    }
  }

  // 구조화 디버그 로그(#822 패턴) — cik·entity·매핑/미매핑·tier.
  const mappedStr = metrics
    .map((m) => `${m.key}:${m.tier === 1 ? 'tag' : m.tier === 2 ? 'alias' : 'llm'}`)
    .join(',');
  console.info(
    `[desk-debug] sec-fin cik=${cik} entity=${entityName} mapped=${mappedStr || 'none'}(${metrics.length}) unmapped=${unmapped.map((s) => s.key).join(',') || 'none'}`,
  );

  if (!metrics.length) return { ok: false, reason: 'no_report' };

  const fiscalYear = Math.max(...metrics.map((m) => m.periods[0].year));
  const financials: SecFinancials = {
    cik,
    entityName: facts.entityName?.trim() || entityName,
    fiscalYear,
    periodLabel: `FY${fiscalYear}`,
    metrics,
  };

  // 성공 결과만 캐시. await 로 영속 보장 → warm-up 값을 crawl task 가 확실히 히트.
  try {
    await setCache(cacheKey, financials);
  } catch (err) {
    console.error('[sec-fin] cache persist failed', err);
  }

  return { ok: true, financials };
}

// ── orchestrator warm-up — 회사 축 확정 후 재무를 미리 받아 캐시 채우기 ──
// market orchestrator 가 crawl 시작 전에 호출한다(DART warmDartFinancials 미러).
// 무거운 companyfacts 호출을 crawl task 15s 벽 밖에서 넉넉한 timeout + LLM fallback
// 허용으로 끝내 캐시에 실으면, 각 SEC crawl task 는 캐시 히트로 즉시 값을 확보한다.
const WARM_TIMEOUT_MS = 15_000;

export async function warmSecFinancials(
  corps: { cik: string; title: string }[],
): Promise<number> {
  if (!corps.length) return 0;
  const { secThrottledAll } = await import('./sec-edgar-common');
  const results = await secThrottledAll(corps, async (c) => {
    try {
      const r = await fetchSecFinancials(c.cik, c.title, {
        timeoutMs: WARM_TIMEOUT_MS,
        allowLlm: true,
      });
      return r.ok;
    } catch {
      return false;
    }
  });
  const warmed = results.filter(Boolean).length;
  console.info(`[desk-debug] sec-fin warm — companies=${corps.length} warmed=${warmed}`);
  return warmed;
}

// ── tier-3 LLM concept-선택 fallback (DART llmSelectMetrics 미러) ──
// 정책: 숫자 생성 금지. LLM 은 "제시된 concept 목록 중 어느 것이 이 지표인가"만
// 고른다. 후보는 미매핑 지표가 필요로 하는 flow 성격에 맞는 concept 로 한정·40개 상한.
const LlmPickSchema = z.object({
  picks: z.array(z.object({ metric: z.string(), concept: z.string().nullable() })),
});

async function llmSelectConcepts(
  usGaap: Record<string, Concept>,
  unmapped: SecMetricSpec[],
  timeoutMs: number,
): Promise<SecMetric[]> {
  const { env } = await import('@/env');
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  // 후보 = USD units 를 가진 concept 만(값이 안 나오는 건 무의미). 라벨과 함께 제시.
  const candidates = Object.entries(usGaap)
    .filter(([, c]) => Array.isArray(c.units?.USD) && c.units!.USD!.length)
    .slice(0, 40)
    .map(([key, c]) => ({ key, label: (c.label ?? '').trim() }));
  if (!candidates.length) return [];

  const candidateLines = candidates
    .map((c) => `- ${c.key}${c.label ? ` (${c.label})` : ''}`)
    .join('\n');
  const metricLines = unmapped
    .map((s) => `- ${s.key}: ${s.labelEn} (${s.flow ? 'income statement flow' : 'balance sheet total'})`)
    .join('\n');

  try {
    const [{ generateObject }, { createAnthropic }, { ZERO_RETENTION }] =
      await Promise.all([
        import('ai'),
        import('@ai-sdk/anthropic'),
        import('@/lib/llm/config'),
      ]);
    const model = createAnthropic({ apiKey })('claude-sonnet-4-6');
    const { object } = await generateObject({
      model,
      system:
        'You map US-GAAP XBRL concepts to standard financial metrics. For each requested metric, pick the single concept key from the provided list that best represents the company-level total. ' +
        'Only pick a key that literally appears in the list; if unsure, return null. Never pick partial or attributable-to-parent line items, and never invent numbers.',
      prompt: [
        'Available concepts:',
        candidateLines,
        '',
        'Metrics to find:',
        metricLines,
        '',
        'Return {metric, concept} for each. Use null when no concept fits.',
      ].join('\n'),
      schema: LlmPickSchema,
      temperature: 0,
      maxOutputTokens: 300,
      maxRetries: 0,
      providerOptions: ZERO_RETENTION,
      timeout: timeoutMs,
    });

    const lowerKeyMap = new Map<string, string>();
    for (const k of Object.keys(usGaap)) lowerKeyMap.set(k.toLowerCase(), k);
    const out: SecMetric[] = [];
    for (const pick of object.picks) {
      if (!pick.concept) continue;
      const realKey = lowerKeyMap.get(pick.concept.toLowerCase());
      if (!realKey) continue;
      const spec = unmapped.find((s) => s.key === pick.metric);
      if (!spec) continue;
      const m = metricFromConcept(spec, usGaap[realKey], realKey, 3);
      if (m) out.push(m);
    }
    return out;
  } catch (err) {
    console.warn('[sec-fin] llm fallback failed (degrade)', err);
    return [];
  }
}

// USD 금액 → 사람이 읽는 축약. P1(#462) formatUsd 재사용($383.3B / $30.8T).
export function formatSecAmount(amount: number): string {
  return formatUsd(amount);
}
