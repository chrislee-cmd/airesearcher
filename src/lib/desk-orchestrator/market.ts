// Market mode — 시장조사. 통계·공시를 위주로 시장 규모(TAM/SAM) "참고 데이터
// 세트"를 수집한다. 이 mode 의 핵심(사용자 확정): TAM/SAM 수치를 LLM 이 자동
// 계산하지 않고, 출처가 명확한 근거 데이터만 표+citation 으로 모아 사용자가
// 직접 판단하게 한다. 판단 근거(소스 선정 / 회사 축 / 제외 사유)는 AI 판단
// 로그 이벤트로 push 되어 보고서 상단 AiJudgmentLog 에 노출된다.
//
// 소유권(충돌 매트릭스): 이 파일(market.ts) 하나만 stub → 실 로직으로 교체한다.
// index.ts / route.ts / types.ts 는 재편집하지 않는다.

import {
  DESK_SOURCE_REGISTRY,
  KR_ONLY_GROUPS,
  getEnabledSources,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';
import { extractMarketCompanies } from '@/lib/desk-market-companies';
import {
  MARKET_REPORT_SYSTEM,
  buildMarketReportUserMsg,
} from '@/lib/desk-market-prompt';
import {
  REGION_AWARE_SOURCES,
  type CrawlTask,
  type OrchestratorInput,
  type OrchestratorPlan,
  type ReportContext,
} from './types';

function sourceLabelKo(id: DeskSourceId): string {
  return DESK_SOURCE_REGISTRY[id]?.label ?? id;
}

// 시장조사 소스 세트 — 통계(KOSIS/ECOS) · 공시(DART) · 학술(Semantic Scholar/
// KCI) · 뉴스(구글/네이버). YouTube · 산하 연구소 RSS · 커뮤니티는 트렌드 위주
// 라 제외한다. route.ts 는 market 소스를 pre-resolve 하지 않으므로(plan 에
// usableSources=[] 로 들어온다) 이 목록이 소스 SSOT 이고, env 가용성/region
// 필터도 여기서 직접 건다.
const MARKET_SOURCE_IDS: DeskSourceId[] = [
  'kosis',
  'boj_ecos',
  'dart',
  'semantic_scholar',
  'kci',
  'google_news',
  'naver_news',
];

const DART: DeskSourceId = 'dart';

export async function runMarket(
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  const { keywords, regions, locale } = input;
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';

  // env 키가 갖춰진 소스만. KR 미포함 지역 조합이면 KR 전용 소스(통계·공시·
  // 국내 학술·네이버)는 결과가 0 이라 제외 (trend 의 effectiveSources 와 동일
  // 규칙, 단 pre-resolve 가 없어 env 필터를 여기서 함께 건다).
  const enabled = new Set(getEnabledSources());
  const effectiveSources = MARKET_SOURCE_IDS.filter((id) => {
    if (!enabled.has(id)) return false;
    if (regions.includes('KR')) return true;
    const group = DESK_SOURCE_REGISTRY[id]?.group;
    return !group || !KR_ONLY_GROUPS.includes(group);
  });

  // 회사 축 — DART 조회용 대표 상장사(LLM). 실패 시 []. crawl/판단 로그 양쪽에
  // 쓰이므로 plan 을 만들기 전에 한 번만 뽑아 closure 로 넘긴다.
  const companies = await extractMarketCompanies(keywords, locale);

  const hasDart = effectiveSources.includes(DART);
  const nonDartSources = effectiveSources.filter((id) => id !== DART);

  return {
    mode: 'market',
    buildJudgmentEvents: ({ similar }) => {
      const sourceList = effectiveSources.map(sourceLabelKo).join(' · ');
      const events: string[] = [
        `🎯 시장조사 mode — 통계·공시 위주로 시장 규모(TAM/SAM) 참고 데이터를 수집합니다. 수치는 확정값이 아닌 근거 데이터로만 제공합니다.`,
        `🔍 원 키워드: ${keywords.map((k) => `‘${k}’`).join(', ')}`,
      ];
      if (similar.length) {
        events.push(
          `🧠 확장 축 (broader/narrower/lateral) = ${similar.map((k) => `‘${k}’`).join(', ')} — 산업/회사/전망 각도로 함께 검색합니다.`,
        );
      }
      events.push(
        companies.length
          ? `🧠 회사 축 = DART 조회 대상 상장사 ${companies.join(' · ')} — SAM(유효 시장) 근거로 공시 매출을 찾습니다.`
          : `🧠 회사 축 = 대표 상장사 추출 실패 — 통계·뉴스 근거만으로 SAM 을 정리합니다 (임의 회사 생성 안 함).`,
      );
      events.push(
        `📰 소스 선정 = ${sourceList || '(가용 소스 없음)'} — TAM=KOSIS·ECOS / SAM=DART / 이론=학술 / 보조=뉴스.`,
        `🚫 제외 = YouTube · 산하 연구소 RSS · 커뮤니티 (트렌드 위주 — 시장 규모 산정 관련성 낮음).`,
        `🧠 TAM/SAM 수치는 자동 계산하지 않습니다 — 모든 수치에 출처(발간처·URL·발간일)를 강제하고, 근거 없는 항목은 “데이터 확보 실패”로 표기합니다.`,
      );
      return events;
    },
    buildCrawlTasks: ({ similar }) => {
      const tasks: CrawlTask[] = [];
      const allKeywords = [...keywords, ...similar];

      // 통계·학술·뉴스 소스 = (원 + 유사) 키워드. region-aware 소스(구글 뉴스)
      // 만 region 마다 별도 crawl, 나머지는 대표 region 한 번.
      const targets: { src: DeskSourceId; region: DeskRegion }[] = [];
      for (const src of nonDartSources) {
        if (REGION_AWARE_SOURCES.has(src)) {
          for (const r of regions) targets.push({ src, region: r });
        } else {
          targets.push({ src, region: primaryRegion });
        }
      }
      for (const kw of allKeywords) {
        for (const { src, region } of targets) {
          tasks.push({ source: src, keyword: kw, region });
        }
      }

      // DART = 공시 검색은 회사명이 정확하므로 회사 축을 검색어로 쓴다. 회사
      // 추출 실패 시엔 원 키워드로 fallback. DART 는 KR 전용이라 region 고정.
      if (hasDart) {
        const dartQueries = companies.length ? companies : keywords;
        for (const q of dartQueries) {
          tasks.push({ source: DART, keyword: q, region: 'KR' });
        }
      }
      return tasks;
    },
    reportSystem: MARKET_REPORT_SYSTEM,
    buildReportUserMsg: (ctx: ReportContext) =>
      buildMarketReportUserMsg(ctx, companies),
  };
}
