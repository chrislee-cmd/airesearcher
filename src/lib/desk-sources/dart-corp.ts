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
export type DartRevenue = { year: number; amount: number; label: string };

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
  if (!corps.length) return null;
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
  return partial[0] ?? null;
}

// 매출로 인정하는 계정명 — 표준 '매출액' 외에 지주/금융사의 '영업수익',
// IFRS 표기 '수익(매출액)' 도 포함.
const REVENUE_ACCOUNTS = ['매출액', '수익(매출액)', '영업수익'];

type FnlttRow = {
  account_nm?: string;
  fs_div?: string; // CFS(연결) | OFS(별도)
  sj_div?: string; // BS | IS | CIS ...
  thstrm_amount?: string; // 당기금액 (콤마 포함 문자열)
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

// 한 연도의 fnlttSinglAcnt 조회 = 1 왕복. 재무 JSON 은 소형이라 5s 상한이면
// 충분하고, 이 상한 덕에 (2연도 + 재시도) 총 왕복이 crawl task 15s cap 안에
// 든다 — 상한을 넘겨 task 가 통째로 잘리는 대신 사유를 남기고 degrade 한다.
async function fetchRevenueYear(
  corpCode: string,
  key: string,
  year: number,
): Promise<YearOutcome> {
  try {
    const params = new URLSearchParams({
      crtfc_key: key,
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: '11011',
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
    const amount = Number(String(pick.thstrm_amount ?? '').replace(/[,\s]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) return { kind: 'no_report' };
    return {
      kind: 'ok',
      revenue: { year, amount, label: pick.account_nm?.trim() || '매출액' },
    };
  } catch (err) {
    return { kind: isAbortError(err) ? 'timeout' : 'api_error' };
  }
}

// 사업보고서(연간, reprt_code=11011) 기준 매출액. 최근 완료 회계연도부터 2개
// 연도를 시도한다(사업보고서는 이듬해 3월경 공시 → 올해분은 아직 없을 수 있음).
// 연결(CFS) 우선. 실패 시 사유를 반환한다 (조용한 null 금지 — decision 3).
//
// transient timeout 은 딱 한 번 재시도한다 (짧은 backoff) — 병렬 DART task 들이
// opendart 를 동시에 두드릴 때 순간 드롭이 첫 회사만 성공하고 나머지를 null 로
// 만드는 걸 흡수한다. 총 왕복은 최대 3회(5s×3=15s)로 묶어 task cap 을 안 넘긴다.
export async function fetchDartRevenue(
  corpCode: string,
  key: string,
): Promise<DartRevenueResult> {
  const nowYear = new Date().getFullYear();
  const MAX_CALLS = 3;
  let calls = 0;
  let sawTimeout = false;
  let sawApiError = false;

  for (const year of [nowYear - 1, nowYear - 2]) {
    if (calls >= MAX_CALLS) break;
    let outcome = await fetchRevenueYear(corpCode, key, year);
    calls += 1;
    // transient timeout → 짧게 한 번 재시도 (호출 예산 남아 있을 때만).
    if (outcome.kind === 'timeout' && calls < MAX_CALLS) {
      sawTimeout = true;
      await delay(300);
      outcome = await fetchRevenueYear(corpCode, key, year);
      calls += 1;
    }
    if (outcome.kind === 'ok') return { ok: true, revenue: outcome.revenue };
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
