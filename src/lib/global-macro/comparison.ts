// P3 "국내 vs G7 대비" 차트 빌더 — **코드 정규화, LLM 파싱 없음**.
//
// 입력 = 수집된 DeskArticle 풀. World Bank/OECD 소스가 article.macro 에 실어 보낸
// 구조화 관측치(MacroObservation: 국가×지표×USD 원값)만 골라, 국가 규모 축에서
// 한국을 G7 옆에 세우는 bar 차트를 만든다. 값은 소스 제공값 그대로 — 정렬·USD
// 표기·최신연도 선택만 코드가 하고 수치는 절대 만들지 않는다(정책: 추정 X).
//
// #461 인프라 재사용: 반환 타입은 DeskChart 라, route.ts 가 이걸 job.analytics.charts
// 앞에 얹으면 기존 DeskAnalyticsPanel 이 그대로 렌더한다(highlight=한국 강조).
//
// graceful degrade: 매크로 관측치가 없거나(국내/도메인만 있는 경우) 대비할 국가가
// 2개 미만이면 빈 배열 — 대비 섹션 없이 국내 리포트만 정상 렌더된다(회귀 없음).

import type { DeskArticle } from '@/lib/desk-sources/types';
import {
  KOREA,
  formatCount,
  formatUsd,
  isKorea,
  latestByCountry,
  representativeYear,
  MACRO_INDICATORS,
  type MacroIndicatorKey,
  type MacroObservation,
} from './normalize';
import type { DeskChart } from '@/components/desk-job-provider';

// 대비 차트로 그릴 지표 우선순위 — GDP(국가 규모)를 최우선, 그다음 산업 부가가치.
// 인구·1인당 GDP 는 규모 대비 인사이트가 약해 차트로는 뽑지 않는다(리포트 본문이
// 필요 시 서술). 최대 2개 차트까지만 만들어 analytics 패널을 과밀하지 않게 한다.
const CHART_INDICATORS: MacroIndicatorKey[] = ['gdp', 'industry'];
const MAX_COMPARISON_CHARTS = 2;

// article 풀에서 구조화 매크로 관측치만 추출. World Bank/OECD 만 macro 를 채우므로
// 여기서 문자열 파싱이 전혀 없다 — "구조화 값 + 정규화 util" 그대로.
export function collectMacroObservations(articles: DeskArticle[]): MacroObservation[] {
  const out: MacroObservation[] = [];
  for (const a of articles) {
    if (a.macro) out.push(a.macro);
  }
  return out;
}

// 한 지표의 관측치 → 대비 bar 차트. 국가별 최신 연도 1건으로 정리하고 값 내림차순
// 정렬(큰 나라부터). 한국 막대를 highlight 로 부각한다. 대비 국가가 2개 미만이면
// 차트를 만들지 않는다(대비의 의미가 없다). value 는 원값 그대로, display 는 코드가
// USD/카운트로 포맷.
function buildIndicatorChart(
  key: MacroIndicatorKey,
  obs: MacroObservation[],
): DeskChart | null {
  const forKey = obs.filter((o) => o.indicator === key);
  if (forKey.length < 2) return null;

  const latest = latestByCountry(forKey).sort((a, b) => b.value - a.value);
  if (latest.length < 2) return null;
  // 한국이 없으면 "국내 vs G7 대비"가 성립하지 않는다 — 차트 skip(정직).
  if (!latest.some((o) => isKorea(o.iso3))) return null;

  const ind = MACRO_INDICATORS[key];
  const refYear = representativeYear(latest);
  const koreaObs = latest.find((o) => isKorea(o.iso3));
  const koreaRank = koreaObs
    ? latest.filter((o) => o.value > koreaObs.value).length + 1
    : undefined;
  const sourceLabel = latest.some((o) => o.source === 'oecd')
    ? 'World Bank · OECD'
    : 'World Bank';

  // insight = 정직한 컨텍스트: 기준 연도·출처·한국 순위. 값은 만들지 않고 서술만.
  const insight =
    koreaObs && koreaRank
      ? `${ind.ko} 기준 한국은 대비 대상 ${latest.length}개국 중 ${koreaRank}위입니다 (${
          koreaObs.year
        }년, ${ind.usd ? formatUsd(koreaObs.value) : `${formatCount(koreaObs.value)}명`}). 값은 ${sourceLabel} 제공 원값이며 환산·정렬만 했습니다.`
      : `${ind.ko}를 국가별로 대비합니다. 값은 ${sourceLabel} 제공 원값입니다.`;

  return {
    type: 'bar',
    title: `국내 vs G7 · ${ind.ko}${refYear ? ` (${refYear})` : ''}`,
    insight,
    unit: 'count',
    highlight: KOREA.ko,
    data: latest.map((o) => ({
      // 국가별 실제 연도가 대표 연도와 다르면 라벨에 병기(연도를 억지로 안 맞춘다).
      label:
        refYear && o.year !== refYear ? `${o.countryKo} (${o.year})` : o.countryKo,
      value: o.value,
      display: o.usd ? formatUsd(o.value) : `${formatCount(o.value)}명`,
    })),
  };
}

// 수집 풀에서 대비 차트(최대 2개)를 코드로 만든다. 매크로 관측치가 없으면 빈 배열
// (graceful — 국내/도메인 전용 리포트는 대비 차트 없이 정상 렌더).
export function buildComparisonCharts(articles: DeskArticle[]): DeskChart[] {
  const obs = collectMacroObservations(articles);
  if (!obs.length) return [];
  const charts: DeskChart[] = [];
  for (const key of CHART_INDICATORS) {
    const chart = buildIndicatorChart(key, obs);
    if (chart) charts.push(chart);
    if (charts.length >= MAX_COMPARISON_CHARTS) break;
  }
  return charts;
}
