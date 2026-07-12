// DART 회사 고유번호(corp_code) 해석 + 상장사 명부 warm-up. market mode 가 회사명을
// DART 검색어로 쓰는데, DART list.json 은 서버사이드 이름 검색이 없어 "최근
// 공시 피드 + 클라이언트 필터" 로는 특정 회사가 거의 0건으로 잡힌다. 이 모듈은
// corp_code 로 회사를 특정해 그 회사의 정기공시 링크와 재무제표 조회의 진입점을
// 안정적으로 만든다. (실제 재무 값 추출·정규화는 `dart-financials.ts` 담당.)
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

// 라틴↔한글 브랜드 이니셜 음차 정규화 (spec B). DART 로스터는 **정식 한글 사명**
// ("엘지생활건강")을 담는데, 유저·LLM 은 라틴 표기("LG생활건강")로 던지는 일이
// 잦아 exact/partial 둘 다 미스 → "비상장 추정" 오행이 났다. 로스터와 쿼리 양쪽에
// 같은 치환을 적용하므로 "LG생활건강"·"엘지생활건강"·"LG생활건강(주)" 가 모두 같은
// 정규형("엘지생활건강")으로 수렴한다. 치환은 소문자 라틴이 있을 때만 발화하므로
// (순수 한글 사명엔 무영향) 오검출 위험이 낮다 — 완전 유사도 매칭이 아니라 표기
// 정규화 수준(과설계 회피). 대표 국내 그룹 이니셜만 큐레이션. **specific-first
// 순서 필수** — "skc"·"kt&g" 를 "sk"·"kt" 보다 먼저 치환해야 접두 오염이 없다.
const BRAND_ALIASES: [RegExp, string][] = [
  [/skc/g, '에스케이씨'],
  [/sk/g, '에스케이'],
  [/kt&g/g, '케이티앤지'],
  [/kt/g, '케이티'],
  [/lg/g, '엘지'],
  [/gs/g, '지에스'],
  [/cj/g, '씨제이'],
  [/ls/g, '엘에스'],
  [/posco/g, '포스코'],
  [/hd/g, '에이치디'],
  [/dl/g, '디엘'],
  [/kb/g, '케이비'],
  [/nhn/g, '엔에이치엔'],
  [/nh/g, '엔에이치'],
];

// 사명 매칭용 정규화 — 괄호 병기·법인격·구두점·공백 제거 + 소문자 + 브랜드 이니셜
// 음차. 로스터·쿼리 양쪽에 동일 적용해 표기 변형(공백/㈜·(주)·주식회사/영문병기/
// 라틴 이니셜)이 같은 정규형으로 모이게 한다.
function normName(s: string): string {
  let out = s.toLowerCase();
  // 괄호 병기 통째 제거 — "(주)", "(유)", "lg생활건강(영문병기)" 등.
  out = out.replace(/\([^)]*\)/g, '');
  // 법인격 어구 제거 (괄호 없는 형태 + ㈜ 합자).
  out = out.replace(/주식회사|유한책임회사|유한회사|합자회사|합명회사|㈜/g, '');
  for (const [re, to] of BRAND_ALIASES) out = out.replace(re, to);
  // 공백·구두점 제거 ("L.G." → "lg" → 위 alias 로 "엘지").
  out = out.replace(/[\s.·・,'"`\-&]/g, '');
  return out.trim();
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

// 회사명 → 상장사 corp_code. normName(괄호병기·법인격·구두점·공백 제거 + 라틴↔한글
// 이니셜 음차) 로 정규화한 뒤 정확 일치 우선, 없으면 포함 관계(짧은 사명 우선 —
// "코스맥스" 가 "코스맥스비티아이" 보다 먼저). 정규화 덕에 "LG생활건강"·"엘지생활건강"·
// "LG생활건강(주)" 가 모두 로스터의 "엘지생활건강" 으로 해석된다. 매칭 실패 시 null →
// 호출부가 옛 방식(공시 피드 필터)으로 fallback.
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
