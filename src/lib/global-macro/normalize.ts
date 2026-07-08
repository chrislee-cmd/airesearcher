// 글로벌 매크로 정규화 util — **P1(World Bank·OECD)에서 신설, P2(EDGAR)·P3(대비
// 섹션)이 재사용하는 공용 기반**. desk-sources 밖(순수 상수/함수, env·LLM 의존
// 없음)에 두어 소스 모듈·오케스트레이터·리포트 어디서든 import 할 수 있게 한다.
//
// 하는 일 3가지:
//   1. ISO 국가코드 표준화 + G7 필터 — World Bank(alpha-3)와 OECD(alpha-3), 그리고
//      alpha-2(WB country.id)가 뒤섞여 오므로 하나의 canonical G7 레코드로 정규화.
//   2. USD/연도 정렬 — 매크로 수치를 사람이 읽는 USD 표기($30.8T)로 포맷하고,
//      국가마다 최신 연도가 다를 수 있어 연도별로 정렬·비교 가능하게 한다.
//   3. indicator 레지스트리 — "GDP/산업/인구" 같은 매크로 대분류를 World Bank 코드
//      + OECD EO measure 로 매핑. 소스 준 명시 값만 쓰고 수치는 절대 만들지 않는다
//      (정책: 환산/정렬은 코드, 값 생성은 금지).

// G7 canonical 레코드. alpha-3(WB/OECD data key)·alpha-2(WB country.id)·ko/en
// 표시명을 한 곳에 둔다. 순서는 시장 규모(명목 GDP) 대략 내림차순 — 리포트에서
// 미국→일본→독일… 순으로 자연스럽게 읽히게 한다.
export interface G7Country {
  iso3: string; // World Bank / OECD data key (USA, JPN …)
  iso2: string; // World Bank country.id (US, JP …)
  ko: string;
  en: string;
}

export const G7: readonly G7Country[] = [
  { iso3: 'USA', iso2: 'US', ko: '미국', en: 'United States' },
  { iso3: 'JPN', iso2: 'JP', ko: '일본', en: 'Japan' },
  { iso3: 'DEU', iso2: 'DE', ko: '독일', en: 'Germany' },
  { iso3: 'GBR', iso2: 'GB', ko: '영국', en: 'United Kingdom' },
  { iso3: 'FRA', iso2: 'FR', ko: '프랑스', en: 'France' },
  { iso3: 'ITA', iso2: 'IT', ko: '이탈리아', en: 'Italy' },
  { iso3: 'CAN', iso2: 'CA', ko: '캐나다', en: 'Canada' },
] as const;

export const G7_ISO3: readonly string[] = G7.map((c) => c.iso3);

// 국내 기준축(한국) — G7 이 아니라 **대비의 기준**이다(P3 "국내 vs G7 대비"). 매크로
// 소스(World Bank/OECD)에서 G7 과 함께 조회해, 대비 섹션·차트가 국가 규모 축에서
// 한국의 위치를 G7 옆에 세울 수 있게 한다. G7 셋과 분리해 둬 `isG7` 의미를 지킨다.
export const KOREA: G7Country = { iso3: 'KOR', iso2: 'KR', ko: '한국', en: 'South Korea' };

// 매크로 대비 조회 대상 = 한국 + G7. 매크로 소스가 이 목록으로 한 번에 받아
// "국내 기준 → G7 대비"의 국가 축을 확보한다. 순서는 국내 기준을 먼저 노출.
export const COMPARISON_COUNTRIES: readonly G7Country[] = [KOREA, ...G7] as const;
export const COMPARISON_ISO3: readonly string[] = COMPARISON_COUNTRIES.map((c) => c.iso3);

// alpha-2/alpha-3 어느 쪽이 와도(대소문자 무관) canonical 레코드로 해석. 한국+G7(대비
// 대상)이 아니면 undefined — 호출부가 국가 필터를 이걸로 건다.
const BY_CODE = new Map<string, G7Country>();
for (const c of COMPARISON_COUNTRIES) {
  BY_CODE.set(c.iso3.toUpperCase(), c);
  BY_CODE.set(c.iso2.toUpperCase(), c);
}

// G7 코드만 별도 집합으로 — normalizeCountry 가 한국도 해석하므로 isG7 을 여기에
// 위임하면 한국이 G7 로 오인된다. G7 멤버십은 이 집합으로만 판정한다.
const G7_CODES = new Set(G7.flatMap((c) => [c.iso3.toUpperCase(), c.iso2.toUpperCase()]));

export function normalizeCountry(code: string | undefined | null): G7Country | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.trim().toUpperCase());
}

export function isG7(code: string | undefined | null): boolean {
  if (!code) return false;
  return G7_CODES.has(code.trim().toUpperCase());
}

export function isKorea(code: string | undefined | null): boolean {
  if (!code) return false;
  return code.trim().toUpperCase() === KOREA.iso3 || code.trim().toUpperCase() === KOREA.iso2;
}

// 매크로 대분류 → 소스별 코드. World Bank 는 전 지표를 커버(명목 USD 시계열),
// OECD Economic Outlook 은 GDP 계열만(단, USD 환산 + 당해/차년 전망 포함)이라
// `oecdMeasure` 가 있는 항목만 OECD 로도 조회한다. `usd:true` = 소스가 이미 USD 로
// 주는 지표(환산 불필요, 검증만) / `usd:false` = 카운트/명수 등 비USD.
export type MacroIndicatorKey =
  | 'gdp'
  | 'gdp_per_capita'
  | 'manufacturing'
  | 'industry'
  | 'population';

export interface MacroIndicator {
  key: MacroIndicatorKey;
  ko: string;
  en: string;
  // World Bank v2 indicator 코드 (모든 항목 보유).
  wbCode: string;
  // OECD Economic Outlook measure 코드 (GDP 계열만; 없으면 OECD 조회 skip).
  oecdMeasure?: string;
  // 소스가 USD 로 제공하는가. GDP/산업 부가가치 = current US$ (WB *.CD). 인구 = 명수.
  usd: boolean;
}

export const MACRO_INDICATORS: Record<MacroIndicatorKey, MacroIndicator> = {
  gdp: {
    key: 'gdp',
    ko: 'GDP (명목, USD)',
    en: 'GDP (current US$)',
    wbCode: 'NY.GDP.MKTP.CD',
    oecdMeasure: 'GDP_USD',
    usd: true,
  },
  gdp_per_capita: {
    key: 'gdp_per_capita',
    ko: '1인당 GDP (USD)',
    en: 'GDP per capita (current US$)',
    wbCode: 'NY.GDP.PCAP.CD',
    usd: true,
  },
  manufacturing: {
    key: 'manufacturing',
    ko: '제조업 부가가치 (USD)',
    en: 'Manufacturing, value added (current US$)',
    wbCode: 'NV.IND.MANF.CD',
    usd: true,
  },
  industry: {
    key: 'industry',
    ko: '산업 부가가치 (USD)',
    en: 'Industry (incl. construction), value added (current US$)',
    wbCode: 'NV.IND.TOTL.CD',
    usd: true,
  },
  population: {
    key: 'population',
    ko: '인구 (명)',
    en: 'Population, total',
    wbCode: 'SP.POP.TOTL',
    usd: false,
  },
};

// 하나의 정규화된 매크로 관측치. 소스(WB/OECD)가 실제로 준 값만 담는다 — value 는
// 절대 계산/추정하지 않는다. 리포트·대비 섹션이 이 shape 으로 국가×지표를 비교한다.
export interface MacroObservation {
  iso3: string;
  countryKo: string;
  countryEn: string;
  indicator: MacroIndicatorKey;
  labelKo: string;
  labelEn: string;
  value: number;
  year: number;
  usd: boolean;
  source: 'world_bank' | 'oecd';
}

// USD 를 사람이 읽는 축약 표기로. $30.8T / $4.4T / $889.6B / $12.3M. 국가 규모
// 대비가 목적이라 조 단위(T)까지 흔히 쓴다. 원값은 그대로 보존하고 표기만 바꾼다.
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const fmt = (n: number, suffix: string) =>
    `${sign}$${(abs / n).toFixed(abs / n >= 100 ? 0 : 1)}${suffix}`;
  if (abs >= 1e12) return fmt(1e12, 'T');
  if (abs >= 1e9) return fmt(1e9, 'B');
  if (abs >= 1e6) return fmt(1e6, 'M');
  if (abs >= 1e3) return fmt(1e3, 'K');
  return `${sign}$${abs.toFixed(0)}`;
}

// 인구 등 비-USD 카운트용. 12,345,678 → "12.3M명 아님" — 원 단위는 호출부가 붙인다.
export function formatCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}만`;
  return value.toLocaleString('en-US');
}

// 관측치를 국가별로 최신 연도 1건만 남긴다(WB mrv / OECD lastN 이 이미 최신이지만
// 다연도가 섞여 와도 안전하게). 그리고 지표별로 "가장 흔한 최신 연도"에 정렬해
// 국가 간 비교 가능한 기준 연도를 노출한다.
export function latestByCountry(obs: MacroObservation[]): MacroObservation[] {
  const best = new Map<string, MacroObservation>();
  for (const o of obs) {
    const k = `${o.indicator}|${o.iso3}`;
    const prev = best.get(k);
    if (!prev || o.year > prev.year) best.set(k, o);
  }
  return [...best.values()];
}

// 한 지표에서 G7 국가들이 공유하는 대표 비교 연도 = 관측치들의 최빈 최신 연도.
// (예: 대부분 2025 인데 한 나라만 2024 면 대표 연도는 2025 로 표기하되, 각 행은
// 자기 실제 연도를 보존한다 — 연도를 억지로 맞추려 값을 옮기지 않는다.)
export function representativeYear(obs: MacroObservation[]): number | undefined {
  if (!obs.length) return undefined;
  const freq = new Map<number, number>();
  for (const o of obs) freq.set(o.year, (freq.get(o.year) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
