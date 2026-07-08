import type { DeskArticle, DeskSourceDefinition } from './types';
import { classifyHttpStatus, safeFetch } from './helpers';
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
const FETCH_TIMEOUT_MS = 12_000;

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

export const worldBank: DeskSourceDefinition = {
  id: 'world_bank',
  category: 'stats',
  group: 'global_macro',
  label: 'World Bank Open Data',
  labelEn: 'World Bank Open Data',
  hint: 'G7 GDP·산업·인구 (명목 USD, 키 없이 동작)',
  async fetch({ keyword }) {
    const ind = resolveIndicator(keyword);
    // country/USA;JPN;… /indicator/{code} — 세미콜론 멀티국가. mrv=1 = 국가별
    // 최신 1개 관측(mrnev 는 멀티국가와 결합 시 Request Error 라 mrv 사용).
    const url =
      `${BASE}/country/${COMPARISON_ISO3.join(';')}/indicator/${ind.wbCode}` +
      `?format=json&mrv=1&per_page=300`;
    let res: Response;
    try {
      res = await safeFetch(url, undefined, FETCH_TIMEOUT_MS);
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
    return out;
  },
};
