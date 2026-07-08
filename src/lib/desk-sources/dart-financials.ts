// DART 재무제표 추출 정규화 — XBRL 표준 계정(account_id) 1순위 + 한글 라벨 alias
// 2순위 + LLM 줄-선택 fallback 3순위.
//
// 왜 이 모듈이 있는가: 재무제표 양식이 회사마다 달라 **한글 라벨이 흔들린다**
// (매출액 / 영업수익 / 수익(매출액) / 매출). 실제로 삼성전자 사업보고서의 매출
// 라벨은 "영업수익"이다. 라벨을 키로 잡으면 회사마다 놓친다. DART 는 재무제표를
// 구조화 API(`fnlttSinglAcntAll`, 단일회사 전체 재무제표) + XBRL 표준 계정 태그
// (account_id) 로 제공하고, 이 태그가 라벨 변동 문제를 근본 해결한다 — 그래서
// 한글 라벨이 아니라 **XBRL account_id 로 지표 키를 잡는다**(라벨은 표시/fallback).
//
// (이전 `dart-corp.ts` 의 fetchDartRevenue 는 fnlttSinglAcnt(주요계정)로 매출
//  1개만 뽑았다. 이 모듈이 그걸 대체·보강해 6개 핵심 지표를 한 번의 보고서
//  응답에서 뽑는다.)
//
// 정책 근간: **공시된 명시 값만 옮긴다**(LLM 생성/추정 금지). LLM fallback 은
// 이미 응답에 있는 계정 줄 중 어느 줄이 그 지표인지 "선택"만 하며, 숫자를
// 만들지 않는다. 모든 함수는 실패 시 throw 하지 않고 사유를 담아 degrade 한다.
// server 전용 모듈 — dart.ts 만 import(env / LLM 의존, 키 마스킹).

import { z } from 'zod';
import { env } from '@/env';
import { getCache, setCache } from '@/lib/cache';
import { cleanApiKey, safeFetch } from './helpers';
import { resolveDartCorp } from './dart-corp';

// ⚠️ 이 모듈은 dart.ts → registry(@/lib/desk-sources) 를 거쳐 **클라이언트 번들에
// 도달 가능**하다 (desk-card-body 등이 registry 에서 DESK_REGIONS 같은 값을 import).
// 따라서 module 최상위에서 서버 전용 env 를 접근하는 것을 import 하면 안 된다 —
// `@/lib/llm/config` 는 top-level 에서 env.LLM_ZERO_RETENTION 를 읽어 클라이언트에서
// "server-side env on client" 로 페이지 전체를 죽인다. LLM 관련 import(ai/anthropic/
// llm-config)는 tier-3 fallback 함수 안에서 **동적 import**(서버 호출 시점에만 평가)
// 한다. env proxy 의 static import 자체는 안전(키 접근 시점에만 검사).

// ── 핵심 지표 세트 (approach a — 시작 범위 6개. 확장은 METRIC_MAP 에 추가만) ──
export type MetricKey =
  | 'revenue'
  | 'operatingProfit'
  | 'netIncome'
  | 'totalAssets'
  | 'totalLiabilities'
  | 'totalEquity';

// 지표별 3층 정규화 규칙. sjDiv=스캔할 재무제표(IS 손익 / CIS 포괄손익 / BS 재무상태),
// xbrlIds=1순위 XBRL account_id(정규화 소문자), koAliases=2순위 한글 라벨(공백 제거,
// **정확 일치**). flow=손익 흐름 지표(분기 보고서에서 누적 add_amount 대상) 여부.
type MetricSpec = {
  key: MetricKey;
  labelKo: string;
  flow: boolean;
  sjDiv: readonly string[];
  xbrlIds: readonly string[];
  koAliases: readonly string[];
};

// account_id 는 신규 taxonomy 가 `ifrs-full_`, 구 taxonomy 가 `ifrs_` prefix 를 쓴다
// (같은 개념). 둘 다 등재한다. 지배주주지분 순이익(ProfitLossAttributableToOwnersOf
// Parent) 처럼 **다른 개념**은 절대 넣지 않는다 — 총액 지표만.
export const METRIC_MAP: readonly MetricSpec[] = [
  {
    key: 'revenue',
    labelKo: '매출액',
    flow: true,
    sjDiv: ['IS', 'CIS'],
    xbrlIds: [
      'ifrs-full_revenue',
      'ifrs_revenue',
      'ifrs-full_revenuefromsaleofgoods',
      'ifrs-full_revenuefromrenderingofservices',
    ],
    // '매출' 단독도 두되 tier-2 는 **정확 일치**라 '매출원가'/'매출채권' 에 오매칭
    // 되지 않는다 (includes 매칭을 쓰지 않는 이유).
    koAliases: ['매출액', '영업수익', '수익(매출액)', '영업수익(매출액)', '매출'],
  },
  {
    key: 'operatingProfit',
    labelKo: '영업이익',
    flow: true,
    sjDiv: ['IS', 'CIS'],
    xbrlIds: ['dart_operatingincomeloss', 'ifrs-full_profitlossfromoperatingactivities'],
    koAliases: ['영업이익', '영업이익(손실)', '영업손익', '영업손실'],
  },
  {
    key: 'netIncome',
    labelKo: '당기순이익',
    flow: true,
    sjDiv: ['IS', 'CIS'],
    xbrlIds: ['ifrs-full_profitloss', 'ifrs_profitloss'],
    koAliases: [
      '당기순이익',
      '당기순이익(손실)',
      '당기순손익',
      '당기순손실',
      '반기순이익',
      '반기순이익(손실)',
      '분기순이익',
      '분기순이익(손실)',
    ],
  },
  {
    key: 'totalAssets',
    labelKo: '자산총계',
    flow: false,
    sjDiv: ['BS'],
    xbrlIds: ['ifrs-full_assets', 'ifrs_assets'],
    koAliases: ['자산총계'],
  },
  {
    key: 'totalLiabilities',
    labelKo: '부채총계',
    flow: false,
    sjDiv: ['BS'],
    xbrlIds: ['ifrs-full_liabilities', 'ifrs_liabilities'],
    koAliases: ['부채총계'],
  },
  {
    key: 'totalEquity',
    labelKo: '자본총계',
    flow: false,
    sjDiv: ['BS'],
    // ifrs-full_EquityAndLiabilities(자본과부채총계) 는 정확 일치라 배제된다.
    xbrlIds: ['ifrs-full_equity', 'ifrs_equity'],
    koAliases: ['자본총계'],
  },
];

// ── 실패 사유(조용한 null 대체 — 2026-07-06 사고 교훈) ─────────────────────────
//   timeout   = 재무 API 응답이 안 와 abort (원거리 리전 지연 / 순간 드롭)
//   no_report = 사업/분기 보고서 없음(013) 또는 손익계산서 자체가 없음 = 근거 부재
//   api_error = 무효 키·요청제한(010/011/012/020/021) 등 API 레벨 오류
export type DartFinancialsFailReason = 'timeout' | 'no_report' | 'api_error';
// 하위호환 별칭 — dart.ts 가 기존 사유 라벨 맵을 재사용한다.
export type DartRevenueReason = DartFinancialsFailReason;

// 한 지표의 한 기간(연도) 값. fnlttSinglAcntAll 은 한 계정 줄에 당기/전기/전전기
// 3기간을 동시에 실어 주므로(추가 API 0), 여기서 3개년 시계열이 나온다.
//   year       = 회계연도 (당기=bsns_year, 전기=-1, 전전기=-2).
//   label      = DART *_nm 원문(예 "제 79 기") — 표시/검증용.
//   amount     = 원 단위 금액. 그 기간 값이 응답에 없으면 null(→ "데이터 확보 실패").
//   cumulative = 누적(add_amount) 기반 여부. 분기/반기 보고서의 flow 지표는 당기·전기를
//                누적으로 뽑아 서로 견줄 수 있게 하고, 전전기(bfefrmtrm)는 DART 가
//                누적 필드를 안 줘 전년도 전체값이므로 false — YOY 동일기준 판정에서
//                다른 기준끼리의 계산을 걸러내는 데 쓴다.
export type DartPeriodValue = {
  year: number;
  label: string;
  amount: number | null;
  cumulative: boolean;
};

export type DartMetric = {
  key: MetricKey;
  labelKo: string;
  amount: number; // 당기 값 (하위호환 — periods[0].amount 와 동일).
  // 당기/전기/전전기 3기간 시계열(항상 길이 3, 결측 기간은 amount=null).
  periods: DartPeriodValue[];
  // 실제 선택된 계정의 한글명(표시용 — 회사에 따라 "영업수익" 등으로 나온다).
  accountNm: string;
  // XBRL account_id (tier-1 매칭 시). tier-2/3 로 잡았으면 원문 그대로(없으면 '').
  accountId: string;
  // 어느 층에서 매칭됐는지 (관측·디버그용).
  tier: 1 | 2 | 3;
  // 연결(CFS) / 별도(OFS) — 요청한 fs_div 로 확정(응답 row 의 fs_div 는 null 이라
  // 신뢰 불가, 아래 probe 로 검증).
  fsDiv: 'CFS' | 'OFS';
};

// YOY(전년比 성장률, %) = (당기 − 전기) / 전기 × 100 을 **코드에서 결정론적으로**
// 계산한다(정책: LLM 계산 금지 — 두 값 모두 cited 라 산술은 안전). 아래 경우는
// 계산 불가로 null 을 돌려 표에서 "—" 로 두고 결코 지어내지 않는다:
//   · 한쪽 기간 값 결측         · 두 기간이 다른 기준(누적 vs 전체 — 견줄 수 없음)
//   · 전기 ≤ 0 (성장률이 무의미/부호 왜곡 — 손실 기저 방어)
export function yoyPct(cur: DartPeriodValue, prev: DartPeriodValue): number | null {
  if (cur.amount === null || prev.amount === null) return null;
  if (cur.cumulative !== prev.cumulative) return null;
  if (prev.amount <= 0) return null;
  return ((cur.amount - prev.amount) / prev.amount) * 100;
}

export type DartFinancials = {
  corpCode: string;
  year: number;
  reprtCode: ReprtCode;
  period: string; // "2024 연간" / "2024 3분기 누적" 등
  fsDiv: 'CFS' | 'OFS';
  rceptNo: string; // 값의 출처 공시 접수번호(rcpNo)
  metrics: DartMetric[]; // 매핑된 지표만
};

export type DartFinancialsResult =
  | { ok: true; financials: DartFinancials }
  | { ok: false; reason: DartFinancialsFailReason };

// 정기보고서 종류 코드 (DART reprt_code). 연간이 가장 authoritative 하지만 이듬해
// 3월경에야 공시되므로, 그 사이 최신 실적은 분기/반기 누적으로만 존재한다(#785).
type ReprtCode = '11011' | '11012' | '11013' | '11014';
const REPRT_PERIOD_KO: Record<ReprtCode, string> = {
  '11011': '연간',
  '11012': '반기 누적',
  '11013': '1분기 누적',
  '11014': '3분기 누적',
};

// fnlttSinglAcntAll 응답 한 줄. fs_div 는 응답에서 null 로 오므로(2026-07-08 라이브
// probe 확인) 쓰지 않는다 — fsDiv 는 요청 param 으로 확정한다.
type FnlttAllRow = {
  rcept_no?: string;
  sj_div?: string; // BS | IS | CIS | CF | SCE
  account_id?: string; // XBRL (비표준이면 '-표준계정코드 미사용-')
  account_nm?: string;
  thstrm_nm?: string; // 당기명 (예 "제 79 기")
  thstrm_amount?: string; // 당기금액 (콤마 포함 문자열)
  thstrm_add_amount?: string; // 당기 누적금액 — 분기/반기 보고서 손익에만 존재
  frmtrm_nm?: string; // 전기명
  frmtrm_amount?: string; // 전기금액 (전년 동일 보고서 기준)
  frmtrm_add_amount?: string; // 전기 누적금액 — 분기/반기 손익에 존재(당기 누적과 견줌)
  bfefrmtrm_nm?: string; // 전전기명
  bfefrmtrm_amount?: string; // 전전기금액 (DART 는 누적 필드를 안 줌 → 전년도 전체값)
};

const DART_API_ERROR_STATUS = new Set(['010', '011', '012', '020', '021']);

function normAccountId(id: string | undefined): string {
  return (id ?? '').trim().toLowerCase();
}
function normNm(nm: string | undefined): string {
  return (nm ?? '').replace(/\s/g, '');
}
// 'Ⅰ.매출액' / 'I.매출액' / '1.매출액' 등 선행 순번 prefix 제거 후 정확 일치.
// 매출원가('매출원가')는 그대로라 오매칭되지 않는다.
function stripLeadingOrdinal(nm: string): string {
  return nm.replace(/^[0-9IVXⅠ-Ⅹⅰ-ⅹ().\-]+/u, '');
}

// DART 금액 문자열 → number. 빈 값/'-' 은 결측(null). 음수(손실)는 허용 —
// 영업이익/순이익은 음수가 정상이다. 괄호 표기(123)도 음수로 방어 처리.
function parseAmount(raw: string | undefined): number | null {
  let s = String(raw ?? '').trim();
  if (!s || s === '-') return null;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),\s]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// 분기/반기 손익은 누적(add_amount) 우선 — 연간과 견줄 수 있는 규모 근거.
// 재무상태표(stock)는 시점값이라 항상 thstrm_amount.
function pickAmount(row: FnlttAllRow, flow: boolean, annual: boolean): number | null {
  if (flow && !annual) {
    return parseAmount(row.thstrm_add_amount) ?? parseAmount(row.thstrm_amount);
  }
  return parseAmount(row.thstrm_amount);
}

// 한 기간 슬롯의 금액을 뽑는다. 누적 기준을 원할 때(flow·비연간) add_amount 가
// 있으면 그것을(견줌 가능), 없으면 amount 로 폴백하되 cumulative=false 로 정직 표기.
function pickSlot(
  add: string | undefined,
  amt: string | undefined,
  wantCumulative: boolean,
): { amount: number | null; cumulative: boolean } {
  if (wantCumulative) {
    const a = parseAmount(add);
    if (a !== null) return { amount: a, cumulative: true };
  }
  return { amount: parseAmount(amt), cumulative: false };
}

// 한 계정 줄 → 당기/전기/전전기 3기간 시계열. baseYear=락한 보고서 bsns_year(당기).
// fnlttSinglAcntAll 정의상 frmtrm=baseYear-1, bfefrmtrm=baseYear-2 라 연도는 산술로
// 확정한다(추가 호출 0). flow·비연간이면 당기·전기를 누적으로 뽑아 YOY 가 동일기준.
// 전전기는 DART 가 누적 필드를 안 줘 항상 전년도 전체값(cumulative=false).
function extractPeriods(
  row: FnlttAllRow,
  flow: boolean,
  annual: boolean,
  baseYear: number,
): DartPeriodValue[] {
  const wantCum = flow && !annual;
  const cur = pickSlot(row.thstrm_add_amount, row.thstrm_amount, wantCum);
  const prev = pickSlot(row.frmtrm_add_amount, row.frmtrm_amount, wantCum);
  const bfe = pickSlot(undefined, row.bfefrmtrm_amount, false);
  return [
    { year: baseYear, label: (row.thstrm_nm ?? '').trim(), amount: cur.amount, cumulative: cur.cumulative },
    { year: baseYear - 1, label: (row.frmtrm_nm ?? '').trim(), amount: prev.amount, cumulative: prev.cumulative },
    { year: baseYear - 2, label: (row.bfefrmtrm_nm ?? '').trim(), amount: bfe.amount, cumulative: bfe.cumulative },
  ];
}

// 한 보고서 응답에서 한 지표를 뽑는다: sjDiv 필터 → tier-1 XBRL id → tier-2 한글
// alias(정확 일치). fs_div 는 요청 param 으로 확정되므로 여기선 분기 안 함.
function matchMetric(
  rows: FnlttAllRow[],
  spec: MetricSpec,
  annual: boolean,
): { row: FnlttAllRow; amount: number; tier: 1 | 2 } | null {
  const inStmt = rows.filter((r) => spec.sjDiv.includes(r.sj_div ?? ''));
  if (!inStmt.length) return null;
  // tier-1: XBRL account_id
  for (const r of inStmt) {
    if (spec.xbrlIds.includes(normAccountId(r.account_id))) {
      const amount = pickAmount(r, spec.flow, annual);
      if (amount !== null) return { row: r, amount, tier: 1 };
    }
  }
  // tier-2: 한글 라벨 정확 일치 (순번 prefix 제거 후)
  for (const r of inStmt) {
    const nm = stripLeadingOrdinal(normNm(r.account_nm));
    if (spec.koAliases.includes(nm)) {
      const amount = pickAmount(r, spec.flow, annual);
      if (amount !== null) return { row: r, amount, tier: 2 };
    }
  }
  return null;
}

// ── (연도 × 보고서종류 × fs_div) 한 번의 fnlttSinglAcntAll 왕복 ─────────────────
// fnlttSinglAcntAll 은 fs_div(OFS 별도 / CFS 연결)가 **필수 파라미터**라(fnlttSinglAcnt
// 와 다름) 연결/별도를 각각 요청해야 한다. timeoutMs 는 호출부가 예산에 맞춰 준다
// (crawl task=5s, warm-up=넉넉).
type StatementOutcome =
  | { kind: 'ok'; rows: FnlttAllRow[] }
  | { kind: DartFinancialsFailReason };

async function fetchStatements(
  corpCode: string,
  key: string,
  year: number,
  reprtCode: ReprtCode,
  fsDiv: 'CFS' | 'OFS',
  timeoutMs: number,
): Promise<StatementOutcome> {
  try {
    const params = new URLSearchParams({
      crtfc_key: key,
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: reprtCode,
      fs_div: fsDiv,
    });
    const res = await safeFetch(
      `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?${params}`,
      undefined,
      timeoutMs,
    );
    if (!res.ok) return { kind: 'api_error' };
    const json = (await res.json()) as { status?: string; list?: FnlttAllRow[] };
    if (json.status !== '000') {
      return DART_API_ERROR_STATUS.has(json.status ?? '')
        ? { kind: 'api_error' }
        : { kind: 'no_report' }; // 013(조회 데이터 없음) 포함 — 근거 부재
    }
    if (!Array.isArray(json.list) || !json.list.length) return { kind: 'no_report' };
    return { kind: 'ok', rows: json.list };
  } catch (err) {
    return { kind: isAbortError(err) ? 'timeout' : 'api_error' };
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
  );
}

// 손익계산서(IS/CIS)가 존재하는 응답만 "보고서 락"의 자격이 있다 — 매출·영업이익·
// 순이익의 원천이라, P&L 없는 응답에 지표를 걸면 안 된다.
function hasProfitLoss(rows: FnlttAllRow[]): boolean {
  return rows.some((r) => r.sj_div === 'IS' || r.sj_div === 'CIS');
}

// (연도 × 보고서종류) ladder — authoritative·최신 순. 각 스텝에서 연결(CFS) 우선,
// 013 이면 별도(OFS) 재시도(#785 정기공시 fallback 정신 계승).
function buildLadder(nowYear: number): Array<{ year: number; reprtCode: ReprtCode }> {
  return [
    { year: nowYear - 1, reprtCode: '11011' }, // 작년 연간
    { year: nowYear - 1, reprtCode: '11014' }, // 작년 3분기 누적
    { year: nowYear - 1, reprtCode: '11012' }, // 작년 반기 누적
    { year: nowYear - 2, reprtCode: '11011' }, // 재작년 연간
    { year: nowYear - 2, reprtCode: '11014' }, // 재작년 3분기 누적
  ];
}

// crawl task 15s cap 보호 — 콜 카운트가 아니라 wall-clock 예산으로 묶는다. 흔한
// 케이스(작년 연간 CFS 200 OK)는 1콜로 끝나고, 최악(연속 timeout)도 예산 안에서
// 멈춰 task 를 통째로 자르지 않는다. LLM fallback 은 남는 예산이 넉넉할 때만.
// orchestrator warm-up 은 task cap 밖이라 넉넉한 예산을 opts 로 주입한다(아래).
const FIN_BUDGET_MS = 14_000;
const PER_CALL_MS = 5_000;
const LLM_MIN_BUDGET_MS = 9_000;

// fnlttSinglAcntAll 은 payload 가 크다(~106KB, fnlttSinglAcnt 의 6.5배). iad1→FSS
// 원거리에서 crawl task 15s 벽 안에 매번 새로 받으면 timeout 위험이 크다(옛 코드
// 주석의 "iad1→FSS 5s 타임아웃"과 동일 위험, payload 가 더 커 악화). 그래서 성공
// 결과를 Supabase 캐시에 실어, orchestrator warm-up(task cap 밖) 이 미리 채우면 각
// DART task 는 캐시 히트로 즉시 값을 확보한다(corpCode.xml warm-up #759 패턴 계승).
// 월 버킷 — 분기 보고서가 새로 공시되면 한 달 내 자동 갱신(≤30일 staleness 허용).
// v2: DartMetric 에 periods(3기간 시계열) 추가 — v1 캐시 객체는 periods 가 없어
// 시계열 렌더가 깨지므로 버전을 올려 옛 shape 을 재사용하지 않는다.
const FIN_CACHE_VERSION = 'v2';
function finCacheKey(corpCode: string): string {
  const now = new Date();
  const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `dart:fin:${FIN_CACHE_VERSION}:${corpCode}:${bucket}`;
}

// crawl task(기본) vs orchestrator warm-up(넉넉) 예산 분리. warm-up 은 15s cap 밖이라
// iad1 지연을 견디는 긴 per-call/budget 을 준다 — 무거운 호출을 여기서 지불한다.
type FinFetchOpts = { perCallMs?: number; budgetMs?: number };

export async function fetchDartFinancials(
  corpCode: string,
  key: string,
  opts: FinFetchOpts = {},
): Promise<DartFinancialsResult> {
  const perCallMs = opts.perCallMs ?? PER_CALL_MS;
  const budgetMs = opts.budgetMs ?? FIN_BUDGET_MS;

  // 캐시 히트 = 원거리 왕복·timeout 위험 0. 성공 결과만 캐시하므로(아래) 실패를
  // 재활용하지 않는다.
  const cacheKey = finCacheKey(corpCode);
  try {
    const cached = await getCache<DartFinancials>(cacheKey);
    if (cached && Array.isArray(cached.metrics) && cached.metrics.length) {
      return { ok: true, financials: cached };
    }
  } catch {
    // 캐시 조회 실패는 무시하고 라이브 조회로 진행.
  }

  const nowYear = new Date().getFullYear();
  const ladder = buildLadder(nowYear);
  const deadline = Date.now() + budgetMs;
  let sawTimeout = false;
  let sawApiError = false;

  // 1) 손익계산서를 담은 첫 보고서를 락한다. 연결(CFS) 우선 → 013 이면 별도(OFS).
  let locked:
    | { rows: FnlttAllRow[]; year: number; reprtCode: ReprtCode; fsDiv: 'CFS' | 'OFS' }
    | null = null;

  outer: for (const step of ladder) {
    for (const fsDiv of ['CFS', 'OFS'] as const) {
      if (Date.now() + perCallMs > deadline) break outer; // 예산 보호
      const outcome = await fetchStatements(
        corpCode,
        key,
        step.year,
        step.reprtCode,
        fsDiv,
        perCallMs,
      );
      if (outcome.kind === 'ok' && hasProfitLoss(outcome.rows)) {
        locked = { rows: outcome.rows, year: step.year, reprtCode: step.reprtCode, fsDiv };
        break outer;
      }
      if (outcome.kind === 'timeout') sawTimeout = true;
      else if (outcome.kind === 'api_error') sawApiError = true;
      // no_report(013): 이 fs_div 엔 없음 → 다음 fs_div/스텝으로.
    }
  }

  if (!locked) {
    const reason: DartFinancialsFailReason = sawTimeout
      ? 'timeout'
      : sawApiError
        ? 'api_error'
        : 'no_report';
    return { ok: false, reason };
  }

  // 2) 락한 보고서에서 6개 지표를 tier-1(XBRL)/tier-2(alias)로 추출.
  const annual = locked.reprtCode === '11011';
  const metrics: DartMetric[] = [];
  const unmapped: MetricSpec[] = [];
  for (const spec of METRIC_MAP) {
    const hit = matchMetric(locked.rows, spec, annual);
    if (hit) {
      metrics.push({
        key: spec.key,
        labelKo: spec.labelKo,
        amount: hit.amount,
        periods: extractPeriods(hit.row, spec.flow, annual, locked.year),
        accountNm: (hit.row.account_nm ?? '').trim(),
        accountId: (hit.row.account_id ?? '').trim(),
        tier: hit.tier,
        fsDiv: locked.fsDiv,
      });
    } else {
      unmapped.push(spec);
    }
  }

  // 3) tier-3 LLM fallback — tier-1/2 가 놓친 **극소수** 지표만, 남는 예산이
  //    넉넉할 때 한 번의 배치 호출로. 이미 응답에 있는 계정 줄 중 선택만 하며
  //    숫자를 만들지 않는다(정책). 실패/키 없음/예산 부족 = 조용히 skip(degrade).
  if (unmapped.length && deadline - Date.now() > LLM_MIN_BUDGET_MS) {
    const timeoutMs = Math.min(LLM_MIN_BUDGET_MS - 500, deadline - Date.now() - 500);
    const picked = await llmSelectMetrics(locked.rows, unmapped, annual, locked.fsDiv, locked.year, timeoutMs);
    for (const m of picked) {
      metrics.push(m);
      const i = unmapped.findIndex((s) => s.key === m.key);
      if (i >= 0) unmapped.splice(i, 1);
    }
  }

  const rceptNo = locked.rows.find((r) => r.rcept_no)?.rcept_no ?? '';

  // 구조화 디버그 로그(#822 패턴) — corp·reprt·period·매핑/미매핑·tier. 키는 없음.
  const mappedStr = metrics
    .map((m) => `${m.key}:${m.tier === 1 ? 'xbrl' : m.tier === 2 ? 'alias' : 'llm'}`)
    .join(',');
  console.info(
    `[desk-debug] dart-fin corp=${corpCode} reprt=${locked.reprtCode} fs=${locked.fsDiv} period=${locked.year} ${REPRT_PERIOD_KO[locked.reprtCode]} mapped=${mappedStr || 'none'}(${metrics.length}) unmapped=${unmapped.map((s) => s.key).join(',') || 'none'}`,
  );

  if (!metrics.length) return { ok: false, reason: 'no_report' };

  const financials: DartFinancials = {
    corpCode,
    year: locked.year,
    reprtCode: locked.reprtCode,
    period: `${locked.year} ${REPRT_PERIOD_KO[locked.reprtCode]}`,
    fsDiv: locked.fsDiv,
    rceptNo,
    metrics,
  };

  // 성공 결과만 캐시(실패는 재활용 안 함). await 로 영속을 보장해 warm-up 이 채운
  // 값을 뒤이은 crawl task 가 확실히 히트하게 한다 — Supabase 왕복 1회는 예산 내.
  try {
    await setCache(cacheKey, financials);
  } catch (err) {
    console.error('[dart-fin] cache persist failed', err);
  }

  return { ok: true, financials };
}

// ── orchestrator warm-up — 회사 축 확정 후 재무제표를 미리 받아 캐시 채우기 ──────
// market orchestrator(runMarket)가 crawl 시작 전에 호출한다. 무거운 fnlttSinglAcntAll
// 호출(iad1→FSS)을 crawl task 15s 벽 밖에서 넉넉한 timeout 으로 끝내 캐시에 실으면,
// 각 DART crawl task 는 캐시 히트로 즉시 값을 확보한다 — 매출 headline 이 안정적으로
// 생성되어 pin(#451) 대상이 되고 리포트에 남는다 (corpCode.xml warm-up #759 패턴 계승).
// 명부(roster)가 준비된 뒤 호출해야 resolveDartCorp 가 캐시로 회사를 특정한다.
// 실패는 조용히 skip — plan 은 계속되고 crawl task 가 라이브로 재시도한다.
// per-call 은 iad1→FSS 106KB 전송을 견디게 넉넉히, budget 은 crawl 시작 지연을
// 과하게 늘리지 않게 상한. 회사들은 병렬이라 총 warm-up wall-clock ≈ 가장 느린
// 회사(≤budget). 흔한 케이스(작년 연간 CFS 첫 콜 히트)는 회사당 ~1콜.
const WARM_PER_CALL_MS = 9_000;
const WARM_BUDGET_MS = 18_000;

export async function warmDartFinancials(
  companies: string[],
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<number> {
  if (!key || !companies.length) return 0;
  const results = await Promise.all(
    companies.map(async (name) => {
      try {
        const corp = await resolveDartCorp(name, key);
        if (!corp) return false;
        const r = await fetchDartFinancials(corp.corpCode, key, {
          perCallMs: WARM_PER_CALL_MS,
          budgetMs: WARM_BUDGET_MS,
        });
        return r.ok;
      } catch {
        return false;
      }
    }),
  );
  const warmed = results.filter(Boolean).length;
  console.info(
    `[desk-debug] dart-fin warm — companies=${companies.length} warmed=${warmed}`,
  );
  return warmed;
}

// ── tier-3 LLM 줄-선택 fallback ───────────────────────────────────────────────
// 정책: 숫자 생성 금지. LLM 은 "제시된 계정 줄 목록 중 어느 index 가 이 지표인가"
// 만 고른다. 후보는 미매핑 지표들의 sjDiv 에 해당하는 줄로 한정하고 40줄로 상한.
const LlmPickSchema = z.object({
  picks: z.array(
    z.object({
      metric: z.string(),
      index: z.number().int().nullable(),
    }),
  ),
});

async function llmSelectMetrics(
  rows: FnlttAllRow[],
  unmapped: MetricSpec[],
  annual: boolean,
  fsDiv: 'CFS' | 'OFS',
  baseYear: number,
  timeoutMs: number,
): Promise<DartMetric[]> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const sjSet = new Set(unmapped.flatMap((s) => s.sjDiv));
  const candidates = rows
    .map((r, i) => ({ i, r }))
    .filter(({ r }) => sjSet.has(r.sj_div ?? ''))
    .slice(0, 40);
  if (!candidates.length) return [];

  const candidateLines = candidates
    .map(
      ({ i, r }) =>
        `#${i} [${r.sj_div}] ${(r.account_nm ?? '').trim()} (id=${(r.account_id ?? '').trim() || '없음'})`,
    )
    .join('\n');
  const metricLines = unmapped
    .map((s) => `- ${s.key}: ${s.labelKo} (${s.sjDiv.join('/')} 재무제표)`)
    .join('\n');

  try {
    // 동적 import — 서버 호출 시점에만 평가. module top-level 에서 import 하면
    // llm/config 의 top-level env 접근이 클라이언트 번들을 죽인다(위 주석 참고).
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
        '너는 재무제표 계정 매퍼다. 주어진 계정 줄 목록에서, 각 요청 지표에 해당하는 줄의 index 를 고른다. ' +
        '반드시 목록에 실재하는 줄만 고르고, 확신이 없으면 index=null 로 둔다. 총액/합계 계정을 고르며 ' +
        '부분항목(지배주주지분·비지배지분·매출원가·매출총이익 등)은 절대 고르지 않는다. 숫자를 만들지 않는다.',
      prompt: [
        '계정 줄 목록:',
        candidateLines,
        '',
        '찾을 지표:',
        metricLines,
        '',
        '각 지표마다 {metric, index} 를 반환. 해당 줄이 없으면 index=null.',
      ].join('\n'),
      schema: LlmPickSchema,
      temperature: 0,
      maxOutputTokens: 300,
      maxRetries: 0,
      providerOptions: ZERO_RETENTION,
      timeout: timeoutMs,
    });

    const out: DartMetric[] = [];
    for (const pick of object.picks) {
      if (pick.index === null || pick.index < 0 || pick.index >= rows.length) continue;
      const spec = unmapped.find((s) => s.key === pick.metric);
      if (!spec) continue;
      const row = rows[pick.index];
      // 검증: 고른 줄이 정말 그 지표의 sjDiv 에 속하고 금액이 파싱되는가.
      if (!spec.sjDiv.includes(row.sj_div ?? '')) continue;
      const amount = pickAmount(row, spec.flow, annual);
      if (amount === null) continue;
      out.push({
        key: spec.key,
        labelKo: spec.labelKo,
        amount,
        periods: extractPeriods(row, spec.flow, annual, baseYear),
        accountNm: (row.account_nm ?? '').trim(),
        accountId: (row.account_id ?? '').trim(),
        tier: 3,
        fsDiv,
      });
    }
    return out;
  } catch (err) {
    console.warn('[dart-fin] llm fallback failed (degrade)', err);
    return [];
  }
}

// ── 하위호환: 매출만 필요한 호출부용 얇은 래퍼(기존 fetchDartRevenue 대체) ──────
export type DartRevenue = {
  year: number;
  amount: number;
  label: string;
  period: string;
};
export type DartRevenueResult =
  | { ok: true; revenue: DartRevenue }
  | { ok: false; reason: DartFinancialsFailReason };

// 원 단위 금액 → "N조 M억원" / "M억원" 표기 (읽기 쉬운 요약, 원 수치는 링크로
// 검증 가능). 음수/소수는 방어적으로 반올림.
export function formatKrwAmount(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const jo = Math.floor(abs / 1e12);
  const eok = Math.round((abs % 1e12) / 1e8);
  const sign = amount < 0 ? '-' : '';
  if (jo > 0) return `${sign}${jo}조${eok ? ` ${eok.toLocaleString()}억` : ''}원`;
  return `${sign}${Math.round(abs / 1e8).toLocaleString()}억원`;
}

export async function fetchDartRevenue(
  corpCode: string,
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<DartRevenueResult> {
  const result = await fetchDartFinancials(corpCode, key);
  if (!result.ok) return { ok: false, reason: result.reason };
  const rev = result.financials.metrics.find((m) => m.key === 'revenue');
  if (!rev) return { ok: false, reason: 'no_report' };
  return {
    ok: true,
    revenue: {
      year: result.financials.year,
      amount: rev.amount,
      label: rev.accountNm || rev.labelKo,
      period: result.financials.period,
    },
  };
}
