// SEC EDGAR 회사 CIK 해석 + 티커/사명 명부 warm-up. DART 의 `dart-corp.ts` 완벽한
// 등가다 — market mode 가 회사명을 검색어로 쓰는데, SEC 의 companyfacts API 는
// 이름이 아니라 **CIK**(Central Index Key)로만 조회할 수 있다. 이 모듈은 SEC 가
// 공개하는 `company_tickers.json`(티커↔CIK↔사명 전체 매핑, ~10k 상장사)을 받아
// 회사명·티커로 CIK 를 특정한다. (실제 재무 값 추출·정규화는 sec-edgar-financials.ts.)
//
// 모든 함수는 실패 시 throw 하지 않고 null/[] 로 degrade — 네트워크 오류·파싱
// 실패 어디서든 crawl 이 계속되게 한다. sec-edgar.ts 만 import 하는 server 모듈.
//
// SEC fair-use 규약: 모든 요청에 **식별 가능한 User-Agent 헤더가 필수**(없으면
// 403)이고 rate limit 은 ~10 req/s. 명부(company_tickers.json)는 회사 수와 무관하게
// 실행당 1회만 받아 캐시하므로 rate limit 관점에선 무해하다.

import { getCache, setCache } from '@/lib/cache';
import { secFetch } from './sec-edgar-common';

// 한 상장사 = 티커 + CIK(10자리 zero-pad, companyfacts URL 용) + 사명.
export type SecCorp = { cik: string; ticker: string; title: string };

// company_tickers.json 한 항목. 응답은 {"0":{...},"1":{...}} 형태의 인덱스 맵.
type TickerRow = { cik_str?: number; ticker?: string; title?: string };

// 파싱 스키마 버전 — 구조 바뀌면 bump. 명부는 자주 안 변해 월/일 버킷이 불필요.
const TICKERS_CACHE_KEY = 'sec:tickers:v1';

// 사명 매칭용 정규화 — 법인 접미(Inc/Corp/Co/Ltd/PLC …)·구두점·공백 제거 + 소문자.
// "Apple Inc." → "apple", "NIKE, Inc." → "nike", "Alphabet Inc." → "alphabet".
const LEGAL_SUFFIX =
  /\b(incorporated|corporation|company|holdings?|group|limited|inc|corp|co|ltd|plc|lp|llc|sa|ag|nv)\b/g;
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/[.,'"()\-]/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

// 한 serverless 실행 안에서 여러 SEC task(회사 5개)가 명부를 공유하도록 module-level
// 로 메모이즈 — Supabase 캐시 왕복을 1회로 줄인다. 실패(빈 배열)는 메모에 고정하지
// 않는다 — 고정하면 warm 인스턴스가 다음 run 에서도 영영 빈 명부를 재사용한다(self-heal).
let rosterMemo: Promise<SecCorp[]> | null = null;

// company_tickers.json 다운로드를 **누가** 지불하는가를 명시적으로 가른다 (DART
// corpCode.xml 과 동일 정신 — 2026-07-06 회귀 방지).
//   allowDownload:true  = warmSecCorps (orchestrator 단계, task cap 밖 — 넉넉한 timeout)
//   allowDownload:false = crawl task 안의 resolveSecCik (15s cap — 원거리 다운로드
//                         금지). 캐시/메모 미스면 즉시 [] 반환해 진단 사유로 빠지고,
//                         그 회사 task 를 다운로드에 붙잡아 통째로 timeout 내는 사태를
//                         원천 차단한다.
async function loadRoster(opts: { allowDownload: boolean }): Promise<SecCorp[]> {
  if (!rosterMemo) {
    rosterMemo = fetchRoster(opts).then((corps) => {
      if (!corps.length) rosterMemo = null;
      return corps;
    });
  }
  return rosterMemo;
}

async function fetchRoster(opts: { allowDownload: boolean }): Promise<SecCorp[]> {
  const cached = await getCache<SecCorp[]>(TICKERS_CACHE_KEY);
  if (cached && Array.isArray(cached) && cached.length) return cached;
  // crawl task 안에서는 캐시 미스여도 원거리 다운로드를 시작하지 않는다.
  if (!opts.allowDownload) return [];
  try {
    // company_tickers.json 은 전 상장사 티커 맵(~1MB). www.sec.gov 는 UA 헤더가
    // 없으면 403. iad1(미국 리전)→SEC 는 국내가 아니라 지연이 작지만, orchestrator
    // 단계에서 미리 받아 캐시에 실어 crawl task 는 캐시 히트로 끝낸다.
    const res = await secFetch(
      'https://www.sec.gov/files/company_tickers.json',
      60_000,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Record<string, TickerRow>;
    const corps: SecCorp[] = [];
    for (const row of Object.values(json)) {
      const cikNum = row.cik_str;
      const ticker = (row.ticker ?? '').trim();
      const title = (row.title ?? '').trim();
      if (typeof cikNum !== 'number' || !ticker || !title) continue;
      // companyfacts 는 CIK 를 10자리 zero-pad 로 요구한다 (CIK0000320193).
      corps.push({ cik: String(cikNum).padStart(10, '0'), ticker, title });
    }
    // 캐시 영속을 검증 가능하게 — fire-and-forget 대신 await + 실패 로그. 미영속이면
    // warm 인스턴스마다 1MB 를 재다운로드해 warm-up 이 무의미해진다. ~10k 항목 JSON ≈
    // 700KB 로 jsonb 한도 내라 정상이면 저장된다.
    if (corps.length) {
      try {
        await setCache(TICKERS_CACHE_KEY, corps);
      } catch (err) {
        console.error('[sec-edgar] tickers cache persist failed', err);
      }
    }
    return corps;
  } catch (err) {
    console.error('[sec-edgar] fetchRoster failed', err);
    return [];
  }
}

// 명부 warm-up — market orchestrator(runMarket)가 crawl 시작 전에 호출한다.
// company_tickers.json 다운로드를 crawl task 의 15s 벽 밖에서 미리 끝내고 Supabase
// 캐시에 실어, 각 SEC task 는 캐시 히트로 즉시 회사를 특정하게 한다 (DART
// warmDartCorps 와 동일 패턴). 반환 = 명부 건수 (0 = 실패, 판단 로그에 노출용).
export async function warmSecCorps(): Promise<number> {
  const corps = await loadRoster({ allowDownload: true });
  return corps.length;
}

// 회사명 또는 티커 → CIK. 티커 정확 일치(대문자) 우선 → 사명 정확 일치 → 포함 관계
// (짧은 사명 우선 — "Apple" 이 "Apple Hospitality" 보다 먼저). 실패 시 null →
// 호출부가 진단 사유를 남긴다. crawl task 안이라 캐시/메모만(다운로드 없음).
export async function resolveSecCik(name: string): Promise<SecCorp | null> {
  const corps = await loadRoster({ allowDownload: false });
  // 진단 구분: null 이 "명부 미준비(warm-up/캐시 미스)"인지 "명부엔 없음(비상장·
  // 외국 미등록)"인지 로그로 가른다 — root cause 가 완전히 다르다.
  if (!corps.length) {
    console.warn(`[desk-debug] sec resolve — roster_unready name=${name}`);
    return null;
  }
  const raw = name.trim();
  if (!raw) return null;

  // 티커 정확 일치 (사용자가 "AAPL" 처럼 티커를 직접 넣은 경우).
  const upper = raw.toUpperCase();
  const byTicker = corps.find((c) => c.ticker.toUpperCase() === upper);
  if (byTicker) return byTicker;

  const q = normName(raw);
  if (!q) return null;

  const exact = corps.find((c) => normName(c.title) === q);
  if (exact) return exact;

  const partial = corps
    .filter((c) => {
      const n = normName(c.title);
      return n.includes(q) || q.includes(n);
    })
    .sort((a, b) => a.title.length - b.title.length);
  if (!partial.length) {
    console.info(`[desk-debug] sec resolve — unlisted name=${name} roster=${corps.length}`);
  }
  return partial[0] ?? null;
}

// 명부가 (다운로드 없이) 준비돼 있는지 확인용 크기. corp 미해석이 "미등록(명부엔
// 없음)"인지 "명부 미준비"인지 sec-edgar.ts 가 가려 진단 사유를 정확히 붙이기 위한
// 헬퍼. loadRoster 는 메모/캐시라 추가 왕복이 없다.
export async function secRosterSize(): Promise<number> {
  const corps = await loadRoster({ allowDownload: false });
  return corps.length;
}
