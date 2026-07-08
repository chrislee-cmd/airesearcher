import type { DeskArticle, DeskFetchResult, DeskSourceDefinition } from './types';
import { classifyHttpStatus, safeFetchRetry } from './helpers';
import { getCache, setCache } from '@/lib/cache';
import {
  COMPARISON_ISO3,
  MACRO_INDICATORS,
  formatUsd,
  normalizeCountry,
  type MacroIndicator,
  type MacroIndicatorKey,
} from '@/lib/global-macro/normalize';

// OECD Data (Data Explorer, SDMX-JSON REST) — 무료·키X. G7 을 포함한 OECD 회원국
// 경제지표의 2차 권위 소스. World Bank(명목 USD 실적치)와 상호보완: OECD Economic
// Outlook 은 GDP 를 **USD 환산 + 당해/차년 전망**까지 제공한다(대비 기준선의 forward 축).
//
// dataflow 선택(라이브 프로브로 확정, 2026-07-08): 표준 QNA(DSD_NAMAIN1@DF_QNA)는
// 13차원 키 + 정확한 measure/price/adjustment 코드를 요구해 조용히 NoResultsFound 로
// 실패한다. 대신 **Economic Outlook(DSD_EO@DF_EO)** 은 3차원 단순 키
// `{REF_AREA}.{MEASURE}.{FREQ}` 라 안정적이고, `GDP_USD`(명목 USD, 고정 환율) measure 로
// G7 멀티국가 + 최신 전망을 한 번에 준다.
//
// ECOS/World Bank 와 같은 매크로 부류 — 시장 키워드가 아니라 고정 지표 앵커로 조회.
// market 오케스트레이터가 `keyword` 에 지표 앵커(gdp)를 넣어 부른다. OECD EO 로
// 커버되는 지표(oecdMeasure 보유)만 조회하고, 나머지 앵커는 조용히 빈 결과로 skip
// (World Bank 가 그 지표를 커버하므로 에러가 아니라 의도된 no-op).

const BASE = 'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.2';
// OECD EO REF_AREA 키 = 한국+G7 alpha-3 를 '+' 로 결합 (SSOT = normalize.ts).
// 한국(KOR)도 OECD 회원이라 EO 에 포함 — 대비 기준축으로 함께 받는다.
const G7_KEY = COMPARISON_ISO3.join('+');
// crawl 폴백은 짧게, warm-up 은 넉넉하게 (World Bank 와 동일 원리 — §7.5 iad1 콜드).
const FETCH_TIMEOUT_MS = 10_000;
const WARM_TIMEOUT_MS = 14_000;

// 지표별 산출 DeskArticle[] Supabase 캐시 — 연 단위 스코프(최신 연도 advance 자연
// 무효화). warm-up 이 쓰고 crawl task 가 읽어 iad1 콜드+간헐 5xx 를 15s 벽 밖으로 뺀다.
function cacheKey(key: MacroIndicatorKey): string {
  return `macro:oecd:${key}:${new Date().getUTCFullYear()}:v1`;
}

// SDMX-JSON 최소 shape — 우리가 읽는 필드만 타입화(스키마가 커서 나머지는 무시).
type SdmxJson = {
  data?: {
    structures?: {
      dimensions?: {
        series?: { id?: string; values?: { id?: string; name?: string }[] }[];
        observation?: { id?: string; values?: { id?: string }[] }[];
      };
    }[];
    dataSets?: {
      // series 키 "i:j:k" → observations 키 "t" → [value, …]
      series?: Record<
        string,
        { observations?: Record<string, (number | null)[]> }
      >;
    }[];
  };
};

function resolveIndicator(keyword: string): MacroIndicator {
  const k = keyword.trim().toLowerCase();
  if (k in MACRO_INDICATORS) return MACRO_INDICATORS[k as MacroIndicatorKey];
  if (k.includes('capita') || k.includes('1인당')) return MACRO_INDICATORS.gdp_per_capita;
  return MACRO_INDICATORS.gdp;
}

// 라이브 조회 1회(재시도 포함) → DeskFetchResult. warm-up 과 crawl 폴백 공유.
async function fetchOecdLive(
  ind: MacroIndicator,
  keyword: string,
  timeoutMs: number,
): Promise<DeskFetchResult> {
  // OECD EO 가 커버하는 지표만 조회. 나머지(제조업·인구 등)는 World Bank 전담이라
  // 여기선 의도적으로 빈 결과 — 에러 아님(무음 0건이 아니라 설계상 no-op임을 로그).
  if (!ind.oecdMeasure) {
    console.info(`[desk-debug] oecd — ind=${ind.key} skip (no EO measure, WB covers)`);
    return { articles: [] };
  }
  // startPeriod 로 최근만 좁히고 국가별 최신 관측 1건만(lastNObservations=1).
  const url =
    `${BASE}/${G7_KEY}.${ind.oecdMeasure}.A` +
    `?startPeriod=2023&lastNObservations=1&format=jsondata`;
  let res: Response;
  try {
    res = await safeFetchRetry(
      url,
      { headers: { Accept: 'application/vnd.sdmx.data+json' } },
      timeoutMs,
    );
  } catch {
    console.error(`[desk-debug] oecd — ind=${ind.key} fetch_error`);
    return { articles: [], error: 'fetch_failed' };
  }
  if (!res.ok) {
    // SDMX 는 매칭 없음을 404(NoResultsFound)로도 준다 — 값 없음이라 error 없이 빈 배열.
    if (res.status === 404) {
      console.info(`[desk-debug] oecd — ind=${ind.key} no_results (404)`);
      return { articles: [] };
    }
    console.error(`[desk-debug] oecd — ind=${ind.key} http=${res.status}`);
    return { articles: [], error: classifyHttpStatus(res.status) };
  }
  let json: SdmxJson;
  try {
    json = JSON.parse(await res.text()) as SdmxJson;
  } catch {
    console.error(`[desk-debug] oecd — ind=${ind.key} parse_error`);
    return { articles: [], error: 'fetch_failed' };
  }

  {
    const struct = json.data?.structures?.[0]?.dimensions;
    const refAreas = struct?.series?.[0]?.values ?? []; // 인덱스 → {id:'USA'}
    const measureName = struct?.series?.[1]?.values?.[0]?.name; // 소스 제공 라벨
    const timeVals = struct?.observation?.[0]?.values ?? []; // 인덱스 → {id:'2026'}
    const series = json.data?.dataSets?.[0]?.series ?? {};

    const out: DeskArticle[] = [];
    for (const [key, s] of Object.entries(series)) {
      // series 키 "i:j:k" — 첫 성분이 REF_AREA 값 인덱스.
      const refIdx = Number(key.split(':')[0]);
      const iso = refAreas[refIdx]?.id;
      const c = normalizeCountry(iso);
      if (!c) continue;
      // observations: "t" → [value]. 국가별 최신(최대 연도) 관측 1건을 고른다.
      let best: { year: number; value: number } | undefined;
      for (const [obsKey, arr] of Object.entries(s.observations ?? {})) {
        const v = Array.isArray(arr) ? arr[0] : null;
        if (typeof v !== 'number') continue;
        const year = Number(timeVals[Number(obsKey)]?.id);
        if (!Number.isFinite(year)) continue;
        if (!best || year > best.year) best = { year, value: v };
      }
      if (!best) continue;
      out.push({
        source: 'oecd',
        title: `${c.ko} ${ind.ko}: ${formatUsd(best.value)} (${best.year}, OECD)`,
        url: `https://data-explorer.oecd.org/?fs[0]=Topic,1%7CEconomy%23ECO%23&pg=0&q=${encodeURIComponent(
          `${c.en} GDP`,
        )}`,
        snippet: `${c.en} · ${measureName ?? ind.en} · ${best.value.toLocaleString(
          'en-US',
        )} (${best.year}) · OECD Economic Outlook (추정·전망 포함)`,
        origin: 'OECD Economic Outlook',
        publishedAt: `${best.year}-12-31`,
        keyword,
        kind: 'metric',
        // 구조화 관측치 — P3 대비 차트가 원값으로 코드 정규화한다(World Bank 와 동형).
        macro: {
          iso3: c.iso3,
          countryKo: c.ko,
          countryEn: c.en,
          indicator: ind.key,
          labelKo: ind.ko,
          labelEn: ind.en,
          value: best.value,
          year: best.year,
          usd: ind.usd,
          source: 'oecd',
        },
      });
    }
    console.info(
      `[desk-debug] oecd — ind=${ind.key} measure=${ind.oecdMeasure} series=${Object.keys(series).length} kept=${out.length}`,
    );
    return { articles: out };
  }
}

// warm-up — runMarket 이 crawl 전(task cap 밖) 호출. OECD EO 커버 지표만 넉넉한
// timeout+재시도로 라이브 조회 후 캐시. 반환 = 캐시된 총 article 수(0=실패/no-op).
export async function warmOecd(): Promise<number> {
  let total = 0;
  for (const key of Object.keys(MACRO_INDICATORS) as MacroIndicatorKey[]) {
    const ind = MACRO_INDICATORS[key];
    if (!ind.oecdMeasure) continue; // OECD 미커버 지표는 warm 대상 아님.
    try {
      const { articles } = await fetchOecdLive(ind, key, WARM_TIMEOUT_MS);
      if (articles.length) {
        await setCache(cacheKey(key), articles).catch((err) =>
          console.error(`[oecd] warm cache persist failed ind=${key}`, err),
        );
        total += articles.length;
      }
    } catch (err) {
      console.error(`[oecd] warm failed ind=${key}`, err);
    }
  }
  console.info(`[desk-debug] oecd warm — cached ${total} articles`);
  return total;
}

export const oecd: DeskSourceDefinition = {
  id: 'oecd',
  category: 'stats',
  group: 'global_macro',
  label: 'OECD Data',
  labelEn: 'OECD Data (Economic Outlook)',
  hint: 'G7 GDP·경제전망 (USD 환산, 키 없이 동작)',
  async fetch({ keyword }) {
    const ind = resolveIndicator(keyword);
    if (!ind.oecdMeasure) {
      console.info(`[desk-debug] oecd — ind=${ind.key} skip (no EO measure, WB covers)`);
      return [];
    }
    // 캐시 우선(warm-up 이 채운 게 정상 경로).
    const cached = await getCache<DeskArticle[]>(cacheKey(ind.key));
    if (cached && Array.isArray(cached) && cached.length) {
      console.info(`[desk-debug] oecd — ind=${ind.key} cache_hit=${cached.length}`);
      return cached;
    }
    // 캐시 미스 — 짧은 timeout 라이브 폴백(재시도 포함).
    const result = await fetchOecdLive(ind, keyword, FETCH_TIMEOUT_MS);
    if (result.articles.length) {
      await setCache(cacheKey(ind.key), result.articles).catch(() => {});
    }
    return result;
  },
};
