import type { DeskArticle, DeskFetchResult, DeskSourceDefinition } from './types';
import { classifyHttpStatus, safeFetchRetry } from './helpers';
import { getCache, setCache } from '@/lib/cache';
import {
  COMPARISON_COUNTRIES,
  COMPARISON_ISO3,
  MACRO_INDICATORS,
  formatCount,
  formatUsd,
  normalizeCountry,
  type MacroIndicator,
  type MacroIndicatorKey,
} from '@/lib/global-macro/normalize';

// World Bank Open Data (api.worldbank.org/v2) — 무료·키X, JSON. 전 세계 GDP·산업
// 부가가치·인구를 명목 USD(*.CD 지표)로 준다. G7 매크로 "대비 기준선"의 1차 소스.
//
// 매크로 소스는 ECOS 와 같은 부류다: 유저의 시장 키워드("라면 시장")로는 매칭이
// 안 되고, 국가 규모/산업 대분류라는 **고정 지표 축**으로 조회한다. 그래서 market
// 오케스트레이터가 `keyword` 에 지표 앵커(gdp / manufacturing / population …)를
// 넣어 부른다 — 여기서 그 앵커를 MACRO_INDICATORS 로 해석해 G7 전체를 한 번의
// 멀티국가 호출로 받는다. 알 수 없는 앵커는 GDP 로 보수적 degrade.
//
// 한 번의 호출로 G7 7개국을 다 받는다(country/USA;JPN;…/indicator/{code}). 값은
// 소스가 준 것만 그대로 쓰고, 코드가 하는 건 USD 표기·연도 라벨링뿐 — 수치 생성 X.

const BASE = 'https://api.worldbank.org/v2';
// crawl task(15s) 안의 라이브 폴백은 짧게 — warm-up 이 이미 캐시를 채운 게 정상
// 경로다. warm-up 은 아래 WARM_TIMEOUT_MS(넉넉) 를 쓴다.
const FETCH_TIMEOUT_MS = 10_000;
const WARM_TIMEOUT_MS = 14_000;

// 지표별 산출 DeskArticle[] 를 Supabase 에 캐시한다(연 단위 스코프 — "최신 연도"가
// 매년 advance 하므로 keyword/버전에 연도를 넣어 자연 무효화). warm-up 이 쓰고,
// crawl task 는 읽기만 해 iad1 콜드(6~9s)+간헐 502 를 15s 벽 밖으로 밀어낸다
// (DART corpCode warm-up 패턴과 동형 — 2026-07-06 회귀 fix 의 재사용).
function cacheKey(key: MacroIndicatorKey): string {
  return `macro:wb:${key}:${new Date().getUTCFullYear()}:v1`;
}

// World Bank v2 는 [meta, rows] 2-튜플을 준다. rows 각 항목:
type WbRow = {
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string }; // country.id = alpha-2
  countryiso3code?: string;
  date?: string; // 연도 "2025"
  value?: number | null;
  unit?: string;
};

// keyword(지표 앵커) → MacroIndicator. market 오케스트레이터는 canonical key 를
// 넘기지만, 방어적으로 별칭/부분일치도 받아준다. 매칭 실패 시 GDP 로 degrade
// (매크로 기준선의 최소 보장 — 국가 규모는 항상 확보).
function resolveIndicator(keyword: string): MacroIndicator {
  const k = keyword.trim().toLowerCase();
  if (k in MACRO_INDICATORS) return MACRO_INDICATORS[k as MacroIndicatorKey];
  if (k.includes('manufactur') || k.includes('제조')) return MACRO_INDICATORS.manufacturing;
  if (k.includes('industr') || k.includes('산업')) return MACRO_INDICATORS.industry;
  if (k.includes('popul') || k.includes('인구')) return MACRO_INDICATORS.population;
  if (k.includes('capita') || k.includes('1인당')) return MACRO_INDICATORS.gdp_per_capita;
  return MACRO_INDICATORS.gdp;
}

// 라이브 조회 1회(재시도 포함) → DeskArticle[]. warm-up 과 crawl 폴백이 공유한다.
// timeoutMs 로 호출부가 예산을 정한다(warm=넉넉, crawl 폴백=짧게).
async function fetchWorldBankLive(
  ind: MacroIndicator,
  keyword: string,
  timeoutMs: number,
): Promise<DeskFetchResult> {
  // country/KOR;USA;… /indicator/{code} — 세미콜론 멀티국가. mrv=1 = 국가별
  // 최신 1개 관측(mrnev 는 멀티국가와 결합 시 Request Error 라 mrv 사용).
  const url =
    `${BASE}/country/${COMPARISON_ISO3.join(';')}/indicator/${ind.wbCode}` +
    `?format=json&mrv=1&per_page=300`;
  let res: Response;
  try {
    res = await safeFetchRetry(url, undefined, timeoutMs);
  } catch {
    console.error(`[desk-debug] world_bank — ind=${ind.key} fetch_error`);
    return { articles: [], error: 'fetch_failed' };
  }
  if (!res.ok) {
    console.error(`[desk-debug] world_bank — ind=${ind.key} http=${res.status}`);
    return { articles: [], error: classifyHttpStatus(res.status) };
  }
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    // WB 는 잘못된 지표/파라미터에 XML 에러 페이지(비-JSON)를 주기도 한다 —
    // 조용히 삼키지 않고 fetch_failed 로 분류한다(무음 0건 방지).
    console.error(`[desk-debug] world_bank — ind=${ind.key} parse_error`);
    return { articles: [], error: 'fetch_failed' };
  }
  // 정상 응답 = [meta, rows]. 에러 응답 = [{message:[…]}] (단일 요소).
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) {
    const msg = Array.isArray(json)
      ? (json[0] as { message?: { key?: string; value?: string }[] })?.message?.[0]?.value
      : undefined;
    console.error(`[desk-debug] world_bank — ind=${ind.key} shape_error msg=${msg ?? ''}`);
    return { articles: [], error: 'fetch_failed' };
  }
  const rows = json[1] as WbRow[];
  const out: DeskArticle[] = [];
  for (const r of rows) {
    const n = typeof r.value === 'number' ? r.value : null;
    if (n == null) continue; // 소스가 값을 안 준 국가·연도는 건너뜀(추정 X).
    // countryiso3code 우선, 없으면 country.id(alpha-2)로 한국+G7 정규화.
    const c = normalizeCountry(r.countryiso3code) ?? normalizeCountry(r.country?.id);
    if (!c) continue; // 한국·G7 외(집계 지역 등) 제외.
    const year = Number(r.date);
    if (!Number.isFinite(year)) continue;
    const display = ind.usd ? formatUsd(n) : `${formatCount(n)}명`;
    out.push({
      source: 'world_bank',
      title: `${c.ko} ${ind.ko}: ${display} (${year})`,
      // 국가별 지표 페이지 — 사용자가 원값·시계열을 직접 검증할 수 있게.
      url: `https://data.worldbank.org/indicator/${ind.wbCode}?locations=${c.iso2}`,
      snippet: `${c.en} · ${ind.en} · ${n.toLocaleString('en-US')} (${year}) · World Bank`,
      origin: 'World Bank Open Data',
      publishedAt: `${year}-12-31`,
      keyword,
      // 매크로 명시 수치 — market 샘플링이 뉴스 사이에서 dropout 시키지 않게 pin.
      kind: 'metric',
      // 구조화 관측치 — P3 대비 차트가 문자열 파싱 없이 이 원값으로 정규화한다.
      macro: {
        iso3: c.iso3,
        countryKo: c.ko,
        countryEn: c.en,
        indicator: ind.key,
        labelKo: ind.ko,
        labelEn: ind.en,
        value: n,
        year,
        usd: ind.usd,
        source: 'world_bank',
      },
    });
  }
  console.info(
    `[desk-debug] world_bank — ind=${ind.key} rows=${rows.length} kept=${out.length}/${COMPARISON_COUNTRIES.length}`,
  );
  return { articles: out };
}

// warm-up — market orchestrator(runMarket)가 crawl 시작 전(task cap 밖)에 호출한다.
// 모든 매크로 앵커를 넉넉한 timeout+재시도로 라이브 조회해 Supabase 캐시에 실어,
// 각 crawl task 가 캐시 히트로 즉시 끝나게 한다. 반환 = 캐시된 총 article 수(0 =
// 전건 실패). 실패해도 throw 안 함 — crawl task 라이브 폴백이 남는다.
export async function warmWorldBank(): Promise<number> {
  let total = 0;
  for (const key of Object.keys(MACRO_INDICATORS) as MacroIndicatorKey[]) {
    const ind = MACRO_INDICATORS[key];
    try {
      const { articles } = await fetchWorldBankLive(ind, key, WARM_TIMEOUT_MS);
      if (articles.length) {
        await setCache(cacheKey(key), articles).catch((err) =>
          console.error(`[world_bank] warm cache persist failed ind=${key}`, err),
        );
        total += articles.length;
      }
    } catch (err) {
      console.error(`[world_bank] warm failed ind=${key}`, err);
    }
  }
  console.info(`[desk-debug] world_bank warm — cached ${total} articles`);
  return total;
}

export const worldBank: DeskSourceDefinition = {
  id: 'world_bank',
  category: 'stats',
  group: 'global_macro',
  label: 'World Bank Open Data',
  labelEn: 'World Bank Open Data',
  hint: 'G7 GDP·산업·인구 (명목 USD, 키 없이 동작)',
  async fetch({ keyword }) {
    const ind = resolveIndicator(keyword);
    // 캐시 우선(warm-up 이 채운 게 정상 경로) — iad1 콜드·502 를 15s 벽 밖으로 뺀다.
    const cached = await getCache<DeskArticle[]>(cacheKey(ind.key));
    if (cached && Array.isArray(cached) && cached.length) {
      console.info(`[desk-debug] world_bank — ind=${ind.key} cache_hit=${cached.length}`);
      return cached;
    }
    // 캐시 미스(warm-up 실패/미실행) — 짧은 timeout 라이브 폴백(재시도 포함).
    const result = await fetchWorldBankLive(ind, keyword, FETCH_TIMEOUT_MS);
    if (result.articles.length) {
      await setCache(cacheKey(ind.key), result.articles).catch(() => {});
    }
    return result;
  },
};
