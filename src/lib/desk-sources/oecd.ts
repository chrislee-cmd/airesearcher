import type { DeskArticle, DeskSourceDefinition } from './types';
import { classifyHttpStatus, safeFetch } from './helpers';
import {
  G7_ISO3,
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
// OECD EO REF_AREA 키 = G7 alpha-3 를 '+' 로 결합 (SSOT = normalize.ts 의 G7).
const G7_KEY = G7_ISO3.join('+');
const FETCH_TIMEOUT_MS = 12_000;

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

export const oecd: DeskSourceDefinition = {
  id: 'oecd',
  category: 'stats',
  group: 'global_macro',
  label: 'OECD Data',
  labelEn: 'OECD Data (Economic Outlook)',
  hint: 'G7 GDP·경제전망 (USD 환산, 키 없이 동작)',
  async fetch({ keyword }) {
    const ind = resolveIndicator(keyword);
    // OECD EO 가 커버하는 지표만 조회. 나머지(제조업·인구 등)는 World Bank 전담이라
    // 여기선 의도적으로 빈 결과 — 에러 아님(무음 0건이 아니라 설계상 no-op임을 로그).
    if (!ind.oecdMeasure) {
      console.info(`[desk-debug] oecd — ind=${ind.key} skip (no EO measure, WB covers)`);
      return [];
    }
    // startPeriod 로 최근만 좁히고 국가별 최신 관측 1건만(lastNObservations=1).
    const url =
      `${BASE}/${G7_KEY}.${ind.oecdMeasure}.A` +
      `?startPeriod=2023&lastNObservations=1&format=jsondata`;
    let res: Response;
    try {
      res = await safeFetch(
        url,
        { headers: { Accept: 'application/vnd.sdmx.data+json' } },
        FETCH_TIMEOUT_MS,
      );
    } catch {
      console.error(`[desk-debug] oecd — ind=${ind.key} fetch_error`);
      return { articles: [], error: 'fetch_failed' };
    }
    if (!res.ok) {
      // SDMX 는 매칭 없음을 404(NoResultsFound)로도 준다 — 값 없음이라 error 없이 빈 배열.
      if (res.status === 404) {
        console.info(`[desk-debug] oecd — ind=${ind.key} no_results (404)`);
        return [];
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
      });
    }
    console.info(
      `[desk-debug] oecd — ind=${ind.key} measure=${ind.oecdMeasure} series=${Object.keys(series).length} kept=${out.length}`,
    );
    return out;
  },
};
