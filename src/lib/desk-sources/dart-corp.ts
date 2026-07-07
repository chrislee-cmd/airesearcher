// DART 회사 고유번호(corp_code) 해석 + 재무(매출) 조회. market mode 가 회사명을
// DART 검색어로 쓰는데, DART list.json 은 서버사이드 이름 검색이 없어 "최근
// 공시 피드 + 클라이언트 필터" 로는 특정 회사가 거의 0건으로 잡힌다. 이 모듈은
// corp_code 로 회사를 특정해 (1) 그 회사의 정기공시 링크와 (2) 사업보고서 기준
// 매출액 수치를 안정적으로 가져와 SAM 근거를 만든다.
//
// 모든 함수는 실패 시 throw 하지 않고 null/[] 로 degrade — DART 키 부재·API 오류·
// 파싱 실패 어디서든 crawl 이 계속되게 한다. dart.ts 만 import 하는 server 모듈.

import { unzipSync } from 'fflate';
import { getCache, setCache } from '@/lib/cache';
import { env } from '@/env';
import { cleanApiKey, pickTag, safeFetch } from './helpers';

export type DartCorp = { corpCode: string; corpName: string; stockCode: string };
// period = 연간/분기 구분 라벨 (예: "2024 연간", "2025 3분기 누적"). 연간 매출과
// 분기/반기 누적 매출을 같은 수치인 양 비교하면 안 되므로 항상 병기한다 (2026-07-06
// 사고 fix: 연간만 조회해 실패 시 빈 표 → 분기/반기 누적 fallback 을 얹으면서 도입).
export type DartRevenue = {
  year: number;
  amount: number;
  label: string;
  period: string;
};

// 매출 조회 실패 사유 — 조용한 null 을 대체한다 (2026-07-06 사고: "확보 실패"
// 단독 표기라 timeout 인지 공시 부재인지 구분 불가했던 게 진단을 막았다).
//   timeout   = 재무 API 응답이 안 와 abort (원거리 리전 지연 / 순간 드롭)
//   no_report = 사업보고서 없음(013) / 매출 계정 행 없음 = 근거 자체가 없음
//   api_error = 무효 키·요청제한(010/011/012/020/021) 등 API 레벨 오류
export type DartRevenueReason = 'timeout' | 'no_report' | 'api_error';
export type DartRevenueResult =
  | { ok: true; revenue: DartRevenue }
  | { ok: false; reason: DartRevenueReason };

// 상장사(고유번호+사명) 목록. corpCode.xml(전 기업 zip)에서 stock_code 가 있는
// 상장사만 추려 캐시한다. 'v1' 은 파싱 스키마 버전 — 구조 바뀌면 bump.
const LISTED_CACHE_KEY = 'dart:corpcode:listed:v1';

// 사명 매칭용 정규화 — 법인 접두/공백 제거 + 소문자.
function normName(s: string): string {
  return s
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

// 한 serverless 실행 안에서 여러 DART task(회사 5개)가 상장사 map 을 공유하도록
// module-level 로 메모이즈 — Supabase 캐시 왕복을 1회로 줄인다. 실패(빈 배열)는
// 메모에 고정하지 않는다 — 고정하면 warm 인스턴스가 다음 run 에서도 영영 빈
// 명부를 재사용한다 (self-heal).
let listedMemo: Promise<DartCorp[]> | null = null;

// 3.5MB corpCode.xml 다운로드를 **누가** 지불하는가를 명시적으로 가른다.
//   allowDownload:true  = warmDartCorps (orchestrator 단계, task cap 밖 — 20s+ OK)
//   allowDownload:false = crawl task 안의 resolveDartCorp (15s cap — 절대 다운로드
//                         금지). 캐시/메모 미스면 즉시 [] 반환해 feed filter 로
//                         빠지고, 그 회사 task 를 다운로드에 붙잡아 통째로 15s
//                         timeout(=전건 0)내는 사태를 원천 차단한다 (2026-07-06
//                         1/5 회귀 방지 — 첫 task 가 다운로드를 트리거하면 병렬
//                         DART task 들이 같은 in-flight 다운로드에 매달려 동반
//                         전멸했다).
async function loadListedCorps(
  key: string,
  opts: { allowDownload: boolean },
): Promise<DartCorp[]> {
  if (!listedMemo) {
    listedMemo = fetchListedCorps(key, opts).then((corps) => {
      if (!corps.length) listedMemo = null;
      return corps;
    });
  }
  return listedMemo;
}

async function fetchListedCorps(
  key: string,
  opts: { allowDownload: boolean },
): Promise<DartCorp[]> {
  const cached = await getCache<DartCorp[]>(LISTED_CACHE_KEY);
  if (cached && Array.isArray(cached) && cached.length) return cached;
  // crawl task 안에서는 캐시 미스여도 원거리 다운로드를 시작하지 않는다.
  if (!opts.allowDownload) return [];
  try {
    // corpCode.xml 은 전 기업 zip(~3.5MB). Vercel 기본 리전(iad1, 미국)에서
    // 한국 FSS 서버로부터 받으면 20s 를 훌쩍 넘겨 abort 될 수 있다 — 그래서
    // 이 다운로드는 crawl task(15s cap) 안이 아니라 warmDartCorps(아래) 로
    // orchestrator 단계에서 미리 수행하고, 결과는 Supabase 캐시로 영속화해
    // 이후 실행은 전부 캐시 히트로 끝낸다. timeout 60s 는 원거리 리전용.
    const res = await safeFetch(
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`,
      undefined,
      60_000,
    );
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const xmlBytes = files['CORPCODE.xml'] ?? Object.values(files)[0];
    if (!xmlBytes) return [];
    const xml = new TextDecoder('utf-8').decode(xmlBytes);

    const corps: DartCorp[] = [];
    const re = /<list>([\s\S]*?)<\/list>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const stockCode = (pickTag(block, 'stock_code') ?? '').trim();
      // 상장사만 — stock_code 가 비면(공백 한 칸으로 오기도 함) 비상장.
      if (!stockCode || !/^\d{5,6}$/.test(stockCode)) continue;
      const corpCode = (pickTag(block, 'corp_code') ?? '').trim();
      const corpName = (pickTag(block, 'corp_name') ?? '').trim();
      if (!corpCode || !corpName) continue;
      corps.push({ corpCode, corpName, stockCode });
    }
    // 캐시 영속을 검증 가능하게 — fire-and-forget 대신 await + 실패 로그. 미영속
    // 이면 warm 인스턴스마다 3.5MB 를 재다운로드해 warm-up 이 무의미해진다
    // (decision 2). ~2,600건 JSON ≈ 200KB 로 jsonb 한도 내라 정상이면 저장되고,
    // 실패 시 Vercel 로그에 명시돼 다음 진단이 즉시 가능하다.
    if (corps.length) {
      try {
        await setCache(LISTED_CACHE_KEY, corps);
      } catch (err) {
        console.error('[dart] corpcode cache persist failed', err);
      }
    }
    return corps;
  } catch (err) {
    console.error('[dart] loadListedCorps failed', err);
    return [];
  }
}

// 상장사 명부 warm-up — market orchestrator(runMarket)가 crawl 시작 전에
// 호출한다. corpCode.xml 다운로드(원거리 리전에서 20s+)를 crawl task 의
// 15s 벽 밖에서 미리 끝내고 Supabase 캐시에 실어, 각 DART task 는 캐시
// 히트로 즉시 회사를 특정하게 한다 (2026-07-06 market DART 0건 회귀의
// root cause fix). 반환 = 명부 건수 (0 = 실패, 판단 로그에 노출용).
export async function warmDartCorps(
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<number> {
  if (!key) return 0;
  // orchestrator 단계 — task cap 밖이라 다운로드를 여기서 지불한다.
  const corps = await loadListedCorps(key, { allowDownload: true });
  return corps.length;
}

// 회사명 → 상장사 corp_code. 정확 일치 우선, 없으면 포함 관계(짧은 사명 우선 —
// "코스맥스" 가 "코스맥스비티아이" 보다 먼저). 매칭 실패 시 null → 호출부가
// 옛 방식(공시 피드 필터)으로 fallback.
export async function resolveDartCorp(
  name: string,
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<DartCorp | null> {
  if (!key) return null;
  // crawl task 안 — 캐시/메모만. 미스면 다운로드 없이 null → feed filter fallback.
  const corps = await loadListedCorps(key, { allowDownload: false });
  // 진단 구분(2026-07-08): null 이 "명부 미준비(warm-up/캐시 미스)"인지 "명부엔
  // 있으나 미등재(비상장/자회사)"인지를 로그로 가른다 — 둘은 root cause 가 완전히
  // 다른데 이전엔 똑같이 조용한 0건이 됐다. 키는 로그에 없음.
  if (!corps.length) {
    console.warn(`[desk-debug] dart resolve — roster_unready name=${name}`);
    return null;
  }
  const q = normName(name);
  if (!q) return null;

  const exact = corps.find((c) => normName(c.corpName) === q);
  if (exact) return exact;

  const partial = corps
    .filter((c) => {
      const n = normName(c.corpName);
      return n.includes(q) || q.includes(n);
    })
    .sort((a, b) => a.corpName.length - b.corpName.length);
  if (!partial.length) {
    console.info(
      `[desk-debug] dart resolve — unlisted name=${name} roster=${corps.length}`,
    );
  }
  return partial[0] ?? null;
}

// 상장사 명부가 (다운로드 없이) 준비돼 있는지 확인용 크기. corp 미해석이
// "비상장/자회사(명부엔 있음)"인지 "명부 미준비"인지 dart.ts 가 가려 진단 사유를
// 정확히 붙이기 위한 헬퍼. loadListedCorps 는 메모/캐시라 추가 왕복이 없다.
export async function listedRosterSize(
  key: string = cleanApiKey(env.DART_API_KEY),
): Promise<number> {
  if (!key) return 0;
  const corps = await loadListedCorps(key, { allowDownload: false });
  return corps.length;
}

// 매출로 인정하는 계정명 — 표준 '매출액' 외에 지주/금융사의 '영업수익',
// IFRS 표기 '수익(매출액)' 도 포함.
const REVENUE_ACCOUNTS = ['매출액', '수익(매출액)', '영업수익'];

type FnlttRow = {
  account_nm?: string;
  fs_div?: string; // CFS(연결) | OFS(별도)
  sj_div?: string; // BS | IS | CIS ...
  thstrm_amount?: string; // 당기금액 (콤마 포함 문자열)
  thstrm_add_amount?: string; // 당기 누적금액 — 분기/반기 보고서에만 존재
};

// 정기보고서 종류 코드 (DART reprt_code). 연간이 가장 authoritative 하지만
// 이듬해 3월경에야 공시되므로, 그 사이 최신 실적은 분기/반기 누적으로만 존재한다.
type ReprtCode = '11011' | '11012' | '11013' | '11014';
// period 라벨용 한국어. 분기/반기는 "누적"을 명시해 연간과 혼동을 막는다.
const REPRT_PERIOD_KO: Record<ReprtCode, string> = {
  '11011': '연간',
  '11012': '반기 누적',
  '11013': '1분기 누적',
  '11014': '3분기 누적',
};

// 010/011/012 = 키 문제, 020/021 = 요청제한 — 모두 재무 조회의 API 레벨 오류.
const DART_API_ERROR_STATUS = new Set(['010', '011', '012', '020', '021']);

// safeFetch 의 abort(=timeout)만 골라낸다. AbortController.abort() 는 undici 에서
// name='AbortError' 로 reject 된다. 그 외(네트워크 리셋 등)는 api_error 로 본다.
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || /abort/i.test(err.message))
  );
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type YearOutcome =
  | { kind: 'ok'; revenue: DartRevenue }
  | { kind: DartRevenueReason };

// (연도, 보고서종류) 한 쌍의 fnlttSinglAcnt 조회 = 1 왕복. 재무 JSON 은 소형이라
// 5s 상한이면 충분하고, 이 상한 덕에 ladder 총 왕복이 crawl task 15s cap 안에
// 든다 — 상한을 넘겨 task 가 통째로 잘리는 대신 사유를 남기고 degrade 한다.
//
// 분기/반기 보고서(11014/11012/11013)의 손익계산서는 thstrm_amount(당기 3개월)와
// thstrm_add_amount(당기 누적)가 다르다. 매출 규모 근거로는 누적을 우선 쓰고,
// 없으면 당기금액으로 떨어진다. 연간(11011)은 thstrm_amount 그대로.
async function fetchRevenueYear(
  corpCode: string,
  key: string,
  year: number,
  reprtCode: ReprtCode,
): Promise<YearOutcome> {
  try {
    const params = new URLSearchParams({
      crtfc_key: key,
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: reprtCode,
    });
    const res = await safeFetch(
      `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?${params}`,
      undefined,
      5_000,
    );
    if (!res.ok) return { kind: 'api_error' };
    const json = (await res.json()) as { status?: string; list?: FnlttRow[] };
    if (json.status !== '000') {
      // 013(조회 데이터 없음) = 근거 부재. 그 외 status = API 레벨 오류.
      return DART_API_ERROR_STATUS.has(json.status ?? '')
        ? { kind: 'api_error' }
        : { kind: 'no_report' };
    }
    if (!Array.isArray(json.list)) return { kind: 'no_report' };

    const rows = json.list.filter((r) => {
      const acc = (r.account_nm ?? '').replace(/\s/g, '');
      return REVENUE_ACCOUNTS.some((a) => acc.includes(a));
    });
    // 연결(CFS) 우선, 없으면 별도(OFS).
    const pick = rows.find((r) => r.fs_div === 'CFS') ?? rows[0];
    if (!pick) return { kind: 'no_report' };
    // 분기/반기는 누적(thstrm_add_amount) 우선 — 연간과 견줄 수 있는 규모 근거.
    const isAnnual = reprtCode === '11011';
    const rawAmount =
      !isAnnual && pick.thstrm_add_amount
        ? pick.thstrm_add_amount
        : pick.thstrm_amount;
    const amount = Number(String(rawAmount ?? '').replace(/[,\s]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) return { kind: 'no_report' };
    return {
      kind: 'ok',
      revenue: {
        year,
        amount,
        label: pick.account_nm?.trim() || '매출액',
        period: `${year} ${REPRT_PERIOD_KO[reprtCode]}`,
      },
    };
  } catch (err) {
    return { kind: isAbortError(err) ? 'timeout' : 'api_error' };
  }
}

// (연도 × 보고서종류) ladder 로 매출액을 조회한다. 가장 authoritative·최신 순:
//   작년 연간(11011) → 작년 3분기 누적(11014) → 작년 반기 누적(11012) →
//   재작년 연간(11011) → 재작년 3분기 누적(11014).
// 연간만 보던 이전 버전은 (a) iad1→FSS 5s 타임아웃, (b) 최신 실적이 아직 분기/반기로만
// 공시된 시점(연간 no_report)에 빈 표를 냈다. 분기/반기 누적 매출로 fallback 해 근거를
// 확보한다. 첫 ok 에서 즉시 반환. 실패 시 사유를 반환한다 (조용한 null 금지 — decision 3).
function buildRevenueLadder(nowYear: number): Array<{ year: number; reprtCode: ReprtCode }> {
  return [
    { year: nowYear - 1, reprtCode: '11011' }, // 작년 연간
    { year: nowYear - 1, reprtCode: '11014' }, // 작년 3분기 누적
    { year: nowYear - 1, reprtCode: '11012' }, // 작년 반기 누적
    { year: nowYear - 2, reprtCode: '11011' }, // 재작년 연간
    { year: nowYear - 2, reprtCode: '11014' }, // 재작년 3분기 누적
  ];
}

// crawl task 15s cap 보호 — 콜 카운트가 아니라 wall-clock 예산으로 묶는다. 스펙의
// "MAX_CALLS×5s≤15s"(=최대 3콜)와 "상한을 4~5로 올려라"가 충돌하므로, 5s 콜 상한을
// 유지한 채 총 소요시간을 deadline 으로 상한한다: ladder 5스텝을 빠른 공통 케이스(각
// 호출 <1s)에선 다 시도하되, 타임아웃이 누적되면 남은 예산이 1콜(5s)을 못 담는 순간
// 멈춰 15s 를 절대 넘기지 않는다. 최악(연속 타임아웃)도 ~13s + 재시도 backoff < 15s.
const LADDER_BUDGET_MS = 13_000;
const PER_CALL_MS = 5_000;

export async function fetchDartRevenue(
  corpCode: string,
  key: string,
): Promise<DartRevenueResult> {
  const nowYear = new Date().getFullYear();
  const ladder = buildRevenueLadder(nowYear);
  const deadline = Date.now() + LADDER_BUDGET_MS;
  let sawTimeout = false;
  let sawApiError = false;
  let retried = false; // transient timeout 재시도는 ladder 전체에서 딱 1회.

  for (const step of ladder) {
    // 다음 콜이 예산을 넘길 것 같으면 시작하지 않는다 (task cap 보호).
    if (Date.now() + PER_CALL_MS > deadline) break;
    let outcome = await fetchRevenueYear(corpCode, key, step.year, step.reprtCode);
    // transient timeout → 짧게 한 번 재시도 (병렬 DART task 들이 opendart 를 동시에
    // 두드릴 때 순간 드롭이 첫 회사만 성공하고 나머지를 null 로 만드는 걸 흡수).
    if (
      outcome.kind === 'timeout' &&
      !retried &&
      Date.now() + PER_CALL_MS <= deadline
    ) {
      sawTimeout = true;
      retried = true;
      await delay(300);
      outcome = await fetchRevenueYear(corpCode, key, step.year, step.reprtCode);
    }
    if (outcome.kind === 'ok') {
      // 연간 no_report → 분기/반기 fallback 성공을 관측 가능하게 (스펙 검증 #4).
      if (step.reprtCode !== '11011') {
        console.info(
          `[dart] revenue fallback ok — corp=${corpCode} reprt=${step.reprtCode} period=${outcome.revenue.period}`,
        );
      }
      return { ok: true, revenue: outcome.revenue };
    }
    if (outcome.kind === 'timeout') sawTimeout = true;
    else if (outcome.kind === 'api_error') sawApiError = true;
  }

  // 사유 우선순위: timeout(인프라·이번 사고) > api_error(키·한도) > no_report(근거 부재).
  const reason: DartRevenueReason = sawTimeout
    ? 'timeout'
    : sawApiError
      ? 'api_error'
      : 'no_report';
  return { ok: false, reason };
}

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
