// EDINET 재무 추출 정규화 — XBRL 표준 요소ID(日本会計基準 jppfs_cor / IFRS jpigp_cor
// / 開示 jpcrp_cor) 1순위 + 표시 라벨 alias 2순위. **DART 의 `dart-financials.ts`
// (#456/#457) 일본판**: EDINET 문서의 XBRL_TO_CSV(type=5)는 재무를 **표준 요소ID +
// 컨텍스트**로 구조화 반환하므로, 회사마다 흔들리는 표시 라벨이 아니라 요소ID 로
// 지표를 잡는다.
//
// 정책 근간(DART 와 동일): **공시된 명시 값만 옮긴다**(LLM 생성/추정 금지). JPY 원값을
// cited 로 보존하고, YOY 는 코드가 결정론적으로 계산, USD 는 참조 환율 근사(≈)로 코드
// 환산. 모든 함수는 실패 시 throw 하지 않고 사유를 담아 degrade 한다.
// server 전용 모듈 — edinet.ts 만 import.

import { getCache, setCache } from '@/lib/cache';
import { unzipSync } from 'fflate';
import {
  formatJpyAmount,
  formatJpyAsUsd,
} from '@/lib/global-macro/normalize';
import {
  EDINET_API_BASE,
  edinetFetch,
  edinetThrottledAll,
  isAbortError,
  withKey,
} from './edinet-common';
import type { EdinetDocRef } from './edinet-corp';

// ── 핵심 지표 세트 (#456 미러 — 6개) ──
export type EdinetMetricKey =
  | 'revenue'
  | 'operatingProfit'
  | 'netIncome'
  | 'totalAssets'
  | 'totalLiabilities'
  | 'totalEquity';

// 지표별 정규화 규칙. tags=1순위 XBRL 요소ID(우선순위 순, 신규/총액 개념 앞), aliases=
// 2순위 표시 라벨(項目名 정확 일치), flow=손익 흐름(期間 duration) 지표 여부.
type EdinetMetricSpec = {
  key: EdinetMetricKey;
  labelKo: string;
  labelJa: string;
  flow: boolean;
  tags: readonly string[];
  aliases: readonly string[];
};

// 요소ID 는 대소문자 그대로(정확 일치는 lower 비교). 총액 지표만 — 세그먼트/内訳
// 요소는 컨텍스트 Member 필터가 배제한다.
export const EDINET_METRIC_MAP: readonly EdinetMetricSpec[] = [
  {
    key: 'revenue',
    labelKo: '매출',
    labelJa: '売上高',
    flow: true,
    tags: [
      'jppfs_cor:NetSales',
      'jppfs_cor:OperatingRevenue1',
      'jppfs_cor:GrossOperatingRevenue',
      'jppfs_cor:NetSalesOfCompletedConstructionContracts',
      'jpigp_cor:RevenueIFRS',
      'jpigp_cor:NetSalesIFRS',
    ],
    aliases: ['売上高', '営業収益', '売上収益', '経常収益'],
  },
  {
    key: 'operatingProfit',
    labelKo: '영업이익',
    labelJa: '営業利益',
    flow: true,
    tags: ['jppfs_cor:OperatingIncome', 'jpigp_cor:OperatingProfitLossIFRS'],
    aliases: ['営業利益', '営業利益（△損失）', '営業損益'],
  },
  {
    key: 'netIncome',
    labelKo: '순이익',
    labelJa: '当期純利益',
    flow: true,
    // 総額 ProfitLoss(少数株主含む) 우선 → IFRS → 親会社株主帰属(headline 관행값)
    // 순. DART 는 지배주주지분을 배제하나, 일본은 親会社帰属이 흔히 인용되는
    // headline 이라 최후 fallback 으로만 허용(총액이 있으면 총액 우선).
    tags: [
      'jppfs_cor:ProfitLoss',
      'jpigp_cor:ProfitLossIFRS',
      'jpcrp_cor:ProfitLossAttributableToOwnersOfParent',
      'jpigp_cor:ProfitLossAttributableToOwnersOfParentIFRS',
    ],
    aliases: ['当期純利益', '当期純利益（△損失）', '親会社株主に帰属する当期純利益'],
  },
  {
    key: 'totalAssets',
    labelKo: '자산총계',
    labelJa: '資産合計',
    flow: false,
    tags: ['jppfs_cor:Assets', 'jpigp_cor:AssetsIFRS'],
    aliases: ['資産合計', '資産の部合計'],
  },
  {
    key: 'totalLiabilities',
    labelKo: '부채총계',
    labelJa: '負債合計',
    flow: false,
    tags: ['jppfs_cor:Liabilities', 'jpigp_cor:LiabilitiesIFRS'],
    aliases: ['負債合計', '負債の部合計'],
  },
  {
    key: 'totalEquity',
    labelKo: '자본총계',
    labelJa: '純資産合計',
    flow: false,
    tags: [
      'jppfs_cor:NetAssets',
      'jpigp_cor:EquityIFRS',
      'jpigp_cor:EquityAttributableToOwnersOfParentIFRS',
    ],
    aliases: ['純資産合計', '純資産の部合計', '資本合計'],
  },
];

export type EdinetFinancialsFailReason = 'timeout' | 'no_report' | 'api_error';

// 한 지표의 한 회계연도 값. amount = JPY 원값(원 엔 단위). 결측이면 null.
export type EdinetPeriodValue = {
  year: number;
  amount: number | null;
};

export type EdinetMetric = {
  key: EdinetMetricKey;
  labelKo: string;
  labelJa: string;
  amount: number; // 당기 값(JPY). periods[0].amount 와 동일.
  periods: EdinetPeriodValue[]; // [당기, 전기, 전전기] 내림차순, 결측 amount=null.
  tag: string; // 선택된 요소ID(또는 라벨 매칭 시 항목명).
  tier: 1 | 2; // 1=요소ID, 2=라벨 alias.
  consolidated: boolean; // 連結 여부.
};

// YOY(전년比, %) = (당기 − 전기)/전기 × 100, 코드가 결정론 계산(#457 미러). 계산 불가
// (결측 / 전기 ≤ 0)면 null → 표에서 "—".
export function edinetYoyPct(
  cur: EdinetPeriodValue,
  prev: EdinetPeriodValue,
): number | null {
  if (cur.amount === null || prev.amount === null) return null;
  if (prev.amount <= 0) return null;
  return ((cur.amount - prev.amount) / prev.amount) * 100;
}

export type EdinetFinancials = {
  docID: string;
  edinetCode: string;
  fiscalYear: number;
  periodLabel: string; // "2024年3月期" 근사 → "2024 有価証券報告書"
  consolidated: boolean;
  metrics: EdinetMetric[];
};

export type EdinetFinancialsResult =
  | { ok: true; financials: EdinetFinancials }
  | { ok: false; reason: EdinetFinancialsFailReason };

// ── CSV(XBRL_TO_CSV) 파싱 ────────────────────────────────────────────────────

// CSV 한 행 = 요소ID / 項目名 / コンテキストID / 相対年度 / 連結・個別 / 期間・時点 /
// ユニットID / 単位 / 値. 우리가 쓰는 필드만.
type CsvRow = {
  elementId: string;
  itemName: string;
  contextId: string;
  unit: string;
  value: string;
};

// 컨텍스트 → 상대연도 슬롯. 連結 총액은 Member 접미가 없는 순수 컨텍스트.
//   CurrentYearDuration / Prior1YearDuration / Prior2YearDuration (flow)
//   CurrentYearInstant  / Prior1YearInstant  / Prior2YearInstant  (stock)
// 個別만 있는 회사는 `_NonConsolidatedMember` 변형을 수용(consolidated=false).
function periodSlot(
  contextId: string,
  flow: boolean,
): { slot: 0 | 1 | 2; consolidated: boolean } | null {
  const suffix = flow ? 'Duration' : 'Instant';
  const bases: Array<{ ctx: string; slot: 0 | 1 | 2 }> = [
    { ctx: `CurrentYear${suffix}`, slot: 0 },
    { ctx: `Prior1Year${suffix}`, slot: 1 },
    { ctx: `Prior2Year${suffix}`, slot: 2 },
  ];
  for (const b of bases) {
    if (contextId === b.ctx) return { slot: b.slot, consolidated: true };
    if (contextId === `${b.ctx}_NonConsolidatedMember`) {
      return { slot: b.slot, consolidated: false };
    }
  }
  return null; // 세그먼트/내訳 등 다른 Member → 총액 아님, 배제.
}

function parseAmount(raw: string): number | null {
  const s = (raw ?? '').replace(/[,\s"]/g, '').trim();
  if (!s || /^[-－–—]+$/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s);
  const body = s.replace(/[()（）]/g, '');
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function stripQuote(s: string): string {
  const t = (s ?? '').trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
  return t;
}

// UTF-16LE(EDINET CSV 기본 인코딩) 디코드 + BOM 제거. tab 구분. 헤더로 열 인덱스를
// 찾되(순서 드리프트 방어) 못 찾으면 표준 위치로 fallback.
function parseCsv(bytes: Uint8Array): CsvRow[] {
  let text: string;
  try {
    text = new TextDecoder('utf-16le').decode(bytes);
  } catch {
    try {
      text = new TextDecoder('utf-8').decode(bytes);
    } catch {
      return [];
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0].split('\t').map(stripQuote);
  const idx = (needle: string, dflt: number) => {
    const i = header.findIndex((h) => h.includes(needle));
    return i >= 0 ? i : dflt;
  };
  const iEl = idx('要素ID', 0);
  const iItem = idx('項目名', 1);
  const iCtx = idx('コンテキストID', 2);
  const iUnit = idx('単位', 7);
  const iVal = idx('値', 8);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (f.length <= iVal) continue;
    const elementId = stripQuote(f[iEl] ?? '');
    if (!elementId) continue;
    rows.push({
      elementId,
      itemName: stripQuote(f[iItem] ?? ''),
      contextId: stripQuote(f[iCtx] ?? ''),
      unit: stripQuote(f[iUnit] ?? ''),
      value: stripQuote(f[iVal] ?? ''),
    });
  }
  return rows;
}

// 한 지표를 tier-1(요소ID)/tier-2(라벨)로 뽑아 3기간 시계열을 만든다. JPY 단위만
// (USD 표기 회사는 소수 — 통화 혼선 방지). 連結 우선, 없으면 個別.
function matchMetric(
  rows: CsvRow[],
  spec: EdinetMetricSpec,
  baseYear: number,
): EdinetMetric | null {
  // (요소ID lower) → 원본 요소ID 존재 여부 확인용은 불필요 — 행을 직접 스캔한다.
  const tagsLower = new Set(spec.tags.map((t) => t.toLowerCase()));
  const aliasSet = new Set(spec.aliases);

  // tier 우선순위: 요소ID(1) > 라벨(2). 各 tier 안에서 連結 > 個別.
  for (const tier of [1, 2] as const) {
    for (const consolidatedWanted of [true, false]) {
      const periods: (number | null)[] = [null, null, null];
      let matchedTag = '';
      let anyHit = false;
      for (const r of rows) {
        if (r.unit && r.unit !== 'JPY') continue; // JPY 값만
        const isTag = tagsLower.has(r.elementId.toLowerCase());
        const isAlias = aliasSet.has(r.itemName);
        if (tier === 1 ? !isTag : isTag || !isAlias) continue; // tier-2 는 태그로 안 잡힌 라벨만
        const ps = periodSlot(r.contextId, spec.flow);
        if (!ps || ps.consolidated !== consolidatedWanted) continue;
        const amt = parseAmount(r.value);
        if (amt === null) continue;
        if (periods[ps.slot] === null) {
          periods[ps.slot] = amt;
          matchedTag = tier === 1 ? r.elementId : r.itemName;
          anyHit = true;
        }
      }
      if (anyHit && periods[0] !== null) {
        return {
          key: spec.key,
          labelKo: spec.labelKo,
          labelJa: spec.labelJa,
          amount: periods[0] as number,
          periods: [
            { year: baseYear, amount: periods[0] },
            { year: baseYear - 1, amount: periods[1] },
            { year: baseYear - 2, amount: periods[2] },
          ],
          tag: matchedTag,
          tier,
          consolidated: consolidatedWanted,
        };
      }
    }
  }
  return null;
}

// periodEnd(YYYY-MM-DD) → baseYear. 결산이 연초(1~2월)면 전년으로(SEC fiscalYearOf
// 정신) — 대다수 3월 결산은 그 해 연도로 라벨("2024年3月期" → 2024).
function baseYearOf(periodEnd: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(periodEnd);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month <= 2 ? year - 1 : year;
}

const DOC_TYPE_KO: Record<string, string> = {
  '120': '有価証券報告書',
  '160': '半期報告書',
  '140': '四半期報告書',
};

const CRAWL_TIMEOUT_MS = 6_000; // crawl task 안 — 캐시 히트가 정상 경로.
const WARM_TIMEOUT_MS = 20_000; // warm-up — 무거운 ZIP 다운로드를 넉넉히.

function finCacheKey(docID: string): string {
  return `edinet:fin:v1:${docID}`; // docID 는 불변 — 월 버킷 불필요.
}

type EdinetFinFetchOpts = { timeoutMs?: number };

// 문서 CSV(type=5, ZIP) 를 받아 6개 지표 3개년을 추출한다. 성공 결과(작음)만 캐시.
export async function fetchEdinetFinancials(
  doc: EdinetDocRef,
  edinetCode: string,
  key: string,
  opts: EdinetFinFetchOpts = {},
): Promise<EdinetFinancialsResult> {
  if (!key) return { ok: false, reason: 'api_error' }; // v2 키 필수.
  const timeoutMs = opts.timeoutMs ?? CRAWL_TIMEOUT_MS;

  const cacheKey = finCacheKey(doc.docID);
  try {
    const cached = await getCache<EdinetFinancials>(cacheKey);
    if (cached && Array.isArray(cached.metrics) && cached.metrics.length) {
      return { ok: true, financials: cached };
    }
  } catch {
    // 캐시 실패는 무시하고 라이브.
  }

  const baseYear = baseYearOf(doc.periodEnd);
  if (baseYear === null) return { ok: false, reason: 'no_report' };

  let bytes: Uint8Array;
  try {
    // ⚠️ withKey URL 은 키를 담는다 — 로그 금지(docID 만 로그).
    const url = withKey(`${EDINET_API_BASE}/documents/${doc.docID}?type=5`, key);
    const res = await edinetFetch(url, timeoutMs);
    if (res.status === 404) return { ok: false, reason: 'no_report' };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'api_error' };
    if (!res.ok) return { ok: false, reason: 'api_error' };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, reason: isAbortError(err) ? 'timeout' : 'api_error' };
  }

  // ZIP → 모든 .csv 병합 파싱(재무 요소는 jppfs/jpigp/jpcrp 여러 CSV 에 흩어짐).
  let rows: CsvRow[];
  try {
    const files = unzipSync(bytes);
    rows = Object.keys(files)
      .filter((n) => /\.csv$/i.test(n))
      .flatMap((n) => parseCsv(files[n]));
  } catch (err) {
    console.warn(`[edinet-fin] unzip/parse failed docID=${doc.docID}`, err);
    return { ok: false, reason: 'no_report' };
  }
  if (!rows.length) return { ok: false, reason: 'no_report' };

  const metrics: EdinetMetric[] = [];
  const unmapped: EdinetMetricKey[] = [];
  for (const spec of EDINET_METRIC_MAP) {
    const hit = matchMetric(rows, spec, baseYear);
    if (hit) metrics.push(hit);
    else unmapped.push(spec.key);
  }

  const consolidated = metrics.some((m) => m.consolidated);
  const mappedStr = metrics
    .map((m) => `${m.key}:${m.tier === 1 ? 'tag' : 'alias'}${m.consolidated ? '' : '(個別)'}`)
    .join(',');
  console.info(
    `[desk-debug] edinet-fin docID=${doc.docID} code=${edinetCode} fy=${baseYear} mapped=${mappedStr || 'none'}(${metrics.length}) unmapped=${unmapped.join(',') || 'none'}`,
  );

  if (!metrics.length) return { ok: false, reason: 'no_report' };

  const financials: EdinetFinancials = {
    docID: doc.docID,
    edinetCode,
    fiscalYear: baseYear,
    periodLabel: `${baseYear} ${DOC_TYPE_KO[doc.docTypeCode] ?? '報告書'}`,
    consolidated,
    metrics,
  };

  try {
    await setCache(cacheKey, financials);
  } catch (err) {
    console.error('[edinet-fin] cache persist failed', err);
  }

  return { ok: true, financials };
}

// warm-up — 회사 축 확정 후 재무를 미리 받아 캐시 채우기(DART/SEC warm 미러).
// docIndex 로 회사→docRef 를 얻은 뒤 무거운 CSV ZIP 을 task cap 밖에서 받는다.
export async function warmEdinetFinancials(
  targets: { doc: EdinetDocRef; edinetCode: string }[],
  key: string,
): Promise<number> {
  if (!key || !targets.length) return 0;
  const results = await edinetThrottledAll(
    targets,
    async (t) => {
      try {
        const r = await fetchEdinetFinancials(t.doc, t.edinetCode, key, {
          timeoutMs: WARM_TIMEOUT_MS,
        });
        return r.ok;
      } catch {
        return false;
      }
    },
    3,
  );
  const warmed = results.filter(Boolean).length;
  console.info(`[desk-debug] edinet-fin warm — targets=${targets.length} warmed=${warmed}`);
  return warmed;
}

// ── 표시 헬퍼 (JPY 원값 + USD 근사) ──
// JPY 원값(cited) + 참조 환율 USD 근사(≈). 정책: 원값 보존, USD 는 코드 환산 근사.
export function formatEdinetAmount(amount: number): string {
  const jpy = formatJpyAmount(amount);
  const usd = formatJpyAsUsd(amount);
  return usd ? `${jpy} (${usd})` : jpy;
}
