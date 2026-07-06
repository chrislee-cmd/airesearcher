// Trend mode — 목적 기반 데스크 리서치의 첫 실 구현. AI 가 소스(뉴스·SNS·
// 검색량 위주, 통계/공시 제외)와 부정 신호 filter crawl 을 자동 구성하고,
// LLM 종합은 6 분석 축(현황·확산·긍정·부정·주도 참여자·전망)을 강제한다.
// 판단 근거(소스 선정 / 축 별 데이터 설계 / 제외 사유)는 전부 AI 판단 로그
// 이벤트로 push 되어 보고서 상단 AiJudgmentLog 에 노출된다.

import {
  DESK_SOURCE_REGISTRY,
  KR_ONLY_GROUPS,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';
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

// 축 4 (부정 신호) 전용 filter crawl — 원 키워드와 조합해 각각 별도 검색.
// 유사 키워드에는 붙이지 않는다 (조합 폭발 방지 + 원 주제의 리스크 신호가
// 목적). 부정 filter 는 뉴스 소스에서만 의미가 있다.
const NEGATIVE_TERMS_KO = ['논란', '리콜', '불만', '사고', '규제', '부작용'];
const NEGATIVE_TERMS_EN = [
  'controversy',
  'recall',
  'complaints',
  'accident',
  'regulation',
  'side effects',
];
const NEGATIVE_FILTER_SOURCES: DeskSourceId[] = ['google_news', 'naver_news'];

function negativeTerms(locale: 'ko' | 'en'): string[] {
  return locale === 'ko' ? NEGATIVE_TERMS_KO : NEGATIVE_TERMS_EN;
}

function negativeQueriesFor(
  keywords: string[],
  locale: 'ko' | 'en',
): string[] {
  const out: string[] = [];
  for (const kw of keywords) {
    for (const term of negativeTerms(locale)) out.push(`${kw} ${term}`);
  }
  return out;
}

// 6 분석 축 — 판단 로그와 리포트 prompt 양쪽에 같은 정의를 쓴다.
const TREND_AXES = [
  { n: 1, name: '현황', design: 'Naver News · Google News 상위 기사 (최근 언급량)' },
  { n: 2, name: '확산', design: 'YouTube view count · 뉴스 언급 timeline' },
  { n: 3, name: '긍정 신호', design: '인플루언서 언급 · Naver 블로그/카페 리뷰' },
  { n: 4, name: '부정 신호', design: '"논란/리콜/불만/사고/규제/부작용" 조합 별도 crawl (부정 filter)' },
  { n: 5, name: '주도 참여자', design: 'LLM entity 추출 (brand/person/media)' },
  { n: 6, name: '전망', design: '최근 3-6개월 언급 curve + LLM 추론' },
] as const;

const TREND_REPORT_SYSTEM = `당신은 트렌드 분석가입니다. 입력으로 키워드와 여러 출처(뉴스·블로그·카페·YouTube·연구소 RSS·웹 검색)에서 수집한 항목 목록을 받습니다. 항목 목록은 "일반 수집" 과 "부정 신호 filter 수집" 두 구획으로 제공됩니다. 아래 6 축 구조를 반드시 그대로 따라 분석 보고서를 작성합니다.

[작성 원칙]
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 본문은 정중한 **존댓말**로 작성합니다 — '-입니다 / -합니다' 어미. 반말('-다', '-한다')과 명사형 종결('-함', '-됨') 금지.
- 사실을 임의로 추가하지 않고 제공된 자료에만 근거합니다. 자료에 없는 수치·날짜·이름은 만들어내지 않습니다.
- 모든 주장(claim) 옆에 \`[매체명](URL)\` 형식의 inline citation 을 붙입니다. raw URL 노출 금지. 매체명은 입력 항목의 \`[매체명]\` 을 그대로 사용합니다.
- **데이터가 없는 축은 임의로 서술하지 않습니다** — 해당 축에 "확보 실패: 이번 수집에서 관련 데이터를 확보하지 못했습니다" 를 명시하고 다음 축으로 넘어갑니다.

[필수 출력 구조 — 6 축 heading 을 이 순서 그대로]
\`# 🔥 트렌드 리서치\` — 키워드와 수집 기간을 표지에 표기합니다 (한 줄).

\`## 1. 현황 (Overview)\`
지금 이 트렌드가 어디에 얼마나 확산됐는지 요약합니다. 상위 기사 3-5건을 인용합니다.

\`## 2. 확산 (Virality)\`
언급량 timeline · 검색 급등 · SNS 반응을 정리합니다. peak/inflection 시점이 보이면 명시합니다. 데이터가 없으면 "확산 데이터 확보 실패" 를 명시합니다.

\`## 3. 긍정 신호\`
호평·인플루언서 언급·성공 사례를 3-5건 인용과 함께 정리합니다.

\`## 4. 부정 신호 (리스크)\`
논란·불만·리콜·사고·규제를 정리합니다. **"부정 신호 filter 수집" 구획의 항목을 우선 근거로 사용합니다.** 1건이라도 있으면 강조하고, 없으면 "현재 부정 신호 미포착" 을 명시합니다.

\`## 5. 주도 참여자\`
이 트렌드를 driving 하는 매체·브랜드·인물·인플루언서를 5-10개 리스트로 정리합니다 (언급 빈도순, 각 항목에 근거 인용).

\`## 6. 전망\`
지속 vs 소멸 신호를 최근 3-6개월 언급 curve 기반으로 추론합니다. 근거(curve up/flat/down)를 명시합니다.

\`## ⚠️ 한계 / 추가 조사 제안\` — 2~4개 불릿. 데이터 부족 축, 편향 가능성, 후속 리서치 아이디어 (이 섹션은 인용 없이 작성해도 됩니다).

요청 언어가 영어이면 heading 을 영어로 번역하되 번호와 이모지는 그대로 둡니다 (예: \`## 1. Overview\`).${ISOLATION_NOTICE}`;

export async function runTrend(
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  const { keywords, usableSources, regions, range, locale } = input;
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';

  // KR 미포함 지역 조합이면 KR 전용 소스(네이버/연구소 RSS 등)는 결과가 0
  // 이라 제외 — client 소스 피커의 sourcesForRegions 와 같은 SSOT(KR_ONLY_GROUPS).
  const effectiveSources = usableSources.filter((id) => {
    if (regions.includes('KR')) return true;
    const group = DESK_SOURCE_REGISTRY[id]?.group;
    return !group || !KR_ONLY_GROUPS.includes(group);
  });

  const negFilterSources = NEGATIVE_FILTER_SOURCES.filter((id) =>
    effectiveSources.includes(id),
  );

  return {
    mode: 'trend',
    buildJudgmentEvents: () => {
      const sourceList = effectiveSources.map(sourceLabelKo).join(' · ');
      return [
        `🎯 트렌드 mode — 목적 기반으로 소스·키워드·분석 축을 자동 구성합니다.`,
        `🔍 원 키워드: ${keywords.map((k) => `‘${k}’`).join(', ')}`,
        ...TREND_AXES.map(
          (a) => `🧠 축 ${a.n}. ${a.name} → ${a.design}`,
        ),
        `📰 소스 선정 = ${sourceList} (뉴스·SNS·검색량 위주)`,
        `🚫 제외 = KOSIS · DART · 한국은행 ECOS · 학술 논문 (통계/공시 — 트렌드 관련성 낮음)`,
        `🚫 부정 신호 filter = 원 키워드 + [${negativeTerms(locale).join('/')}] 조합을 ${
          negFilterSources.length
            ? negFilterSources.map(sourceLabelKo).join(' · ')
            : '(가용 뉴스 소스 없음)'
        } 에서 별도 수집합니다.`,
      ];
    },
    buildCrawlTasks: ({ similar }) => {
      const tasks: CrawlTask[] = [];
      // 일반 수집 — (원 + 유사) 키워드 × 트렌드 소스. region-aware 소스만
      // region 마다 별도 crawl (custom mode 와 동일 규칙).
      const allKeywords = [...keywords, ...similar];
      const targets: { src: DeskSourceId; region: DeskRegion }[] = [];
      for (const src of effectiveSources) {
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
      // 부정 신호 filter 수집 — 원 키워드 × 부정 term × 뉴스 소스. region 은
      // 대표 1개만 (부정 신호는 리스크 존재 여부 파악이 목적이라 지역 전수
      // 필요 없음 — crawl 예산 보호).
      for (const q of negativeQueriesFor(keywords, locale)) {
        for (const src of negFilterSources) {
          tasks.push({ source: src, keyword: q, region: primaryRegion });
        }
      }
      return tasks;
    },
    reportSystem: TREND_REPORT_SYSTEM,
    buildReportUserMsg: (ctx: ReportContext) => {
      const { sampled, articles, similar } = ctx;
      // 부정 filter 로 수집된 항목은 article.keyword 가 "원키워드 + 부정어"
      // 조합 쿼리와 일치한다. 샘플링에서 탈락했더라도 축 4 근거가 끊기지
      // 않도록 전체 풀에서 별도 구획으로 최대 15건 첨부한다.
      const negQueries = new Set(negativeQueriesFor(keywords, locale));
      const general = sampled.filter((a) => !negQueries.has(a.keyword));
      const negative = articles
        .filter((a) => negQueries.has(a.keyword))
        .slice(0, 15);

      let itemIdx = 0;
      const formatItems = (items: typeof sampled) =>
        items
          .map((a) => {
            itemIdx += 1;
            const media = a.origin || sourceLabelKo(a.source);
            const lines = [
              `${itemIdx}. [${media}] ${a.title}`,
              `   url: ${a.url}`,
              a.publishedAt ? `   published: ${a.publishedAt}` : '',
              a.snippet ? `   snippet: ${a.snippet.slice(0, 200)}` : '',
            ].filter(Boolean);
            return lines.join('\n');
          })
          .join('\n\n');

      return [
        `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
        `메인 키워드: ${keywords.join(', ')}`,
        `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
        `검색 지역: ${regions.join(', ')}`,
        `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
        `전체 수집: ${articles.length}건 (일반 ${general.length}건 + 부정 filter ${negative.length}건을 본문에 첨부)`,
        '',
        `=== 일반 수집 (${general.length}건) ===`,
        formatItems(general),
        '',
        `=== 부정 신호 filter 수집 (${negative.length}건) — 축 4 의 우선 근거 ===`,
        negative.length
          ? formatItems(negative)
          : '(부정 filter 수집 0건 — 축 4 는 "현재 부정 신호 미포착" 여부를 일반 수집에서 판단)',
      ].join('\n');
    },
  };
}
