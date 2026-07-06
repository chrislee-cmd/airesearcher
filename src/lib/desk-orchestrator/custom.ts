// Custom mode — 옛 유저용 "소스 직접 선택" flow. 이 파일은 mode selector 도입
// 전 /api/desk/route.ts 안에 있던 crawl task 구성 + 리포트 prompt 를 그대로
// 이관(wrap)한 것이다 — 로직 변경 0 (회귀 안전). 정식 재포장(판단 로그 추가
// 등)은 후속 custom PR(E) 이 이 파일 안에서만 진행한다.

import {
  DESK_SOURCE_REGISTRY,
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

// ── Report category grouping (옛 route.ts 이관) ──────────────────────────────
// 합성 prompt 는 수집 기사를 UI 5 카테고리(뉴스·포털 / 커뮤니티 / 시장 통계 /
// 학술·논문 / 산하 연구소)로 그룹핑해 비어있지 않은 bucket 마다 `## <emoji>
// 카테고리 요약` 섹션 하나를 쓰게 한다. bucket 은 DESK_SOURCE_REGISTRY 의
// `category`(코드 SSOT)에서 파생 — LLM 이 재추론하지 않는다. 레지스트리의
// 세부 카테고리 중 5-카테고리 UI 가 노출 안 하는 `video`(YouTube) / `thought`
// 는 둘 다 `news` 로 접힌다.
type DeskUiCategory = 'news' | 'community' | 'stats' | 'academic' | 'institute';

const UI_CATEGORY_ORDER: DeskUiCategory[] = [
  'news',
  'community',
  'stats',
  'academic',
  'institute',
];

const UI_CATEGORY_HEADING: Record<DeskUiCategory, string> = {
  news: '📰 뉴스·포털',
  community: '💬 커뮤니티',
  stats: '📊 시장 통계',
  academic: '🎓 학술·논문',
  institute: '🏛 산하 연구소',
};

function uiCategoryOf(id: DeskSourceId): DeskUiCategory {
  switch (DESK_SOURCE_REGISTRY[id]?.category) {
    case 'community':
      return 'community';
    case 'stats':
      return 'stats';
    case 'academic':
      return 'academic';
    case 'institute':
      return 'institute';
    // news / video / thought (+ unknown) → 뉴스·포털
    default:
      return 'news';
  }
}

const REPORT_SYSTEM = `당신은 데스크 리서치 보고서를 작성하는 전문 리서처입니다. 입력으로 키워드, 유사 키워드, 그리고 여러 출처에서 수집한 기사/포스트/영상 헤드라인 + 요약 목록을 받습니다. 입력의 항목 목록은 이미 **UI 카테고리 별로 그룹핑**되어 제공됩니다.

[작성 원칙]
- 한국어 Markdown으로 작성합니다 (요청 언어가 영어인 경우 영어).
- 본문은 정중한 **존댓말**로 작성합니다 — 모든 서술은 '-입니다 / -합니다 / -하였습니다 / -보입니다 / -로 보입니다' 어미를 사용합니다. 반말('-다', '-한다', '-이다')과 명사형 종결('-함', '-됨')은 금지합니다.
- 사실을 임의로 추가하지 않고 제공된 자료에만 근거합니다. 자료에 없는 수치·날짜·이름은 만들어내지 않습니다.
- 강조는 **굵게** 를 사용할 수 있습니다.

[인용 규칙 — 반드시 준수]
- 모든 링크는 반드시 \`[매체명](URL)\` 형식의 markdown 링크입니다. 절대 raw URL을 본문에 노출하지 않습니다.
- **각 불릿(claim/사실) 옆에는 반드시 inline citation 을 붙입니다.** 인용 없는 서술은 금지합니다.
  - 좋은 예: "삼성전자 2024 Q3 매출 79조원 [매일경제](https://mk.co.kr/...) [연합뉴스](https://yna.co.kr/...)"
  - 나쁜 예: "삼성전자 2024 Q3 매출 79조원" (인용 없음)
- **각 claim 은 가능하면 2개 이상의 출처를 인용**합니다. 자료에 해당 claim 을 뒷받침하는 출처가 1개뿐이면 1개만 인용해도 됩니다 (억지로 무관한 출처를 붙이지 않습니다).
- **primary source 우선**: 공식 통계·공시(DART / KOSIS / 한국은행 ECOS / 산하 연구소 리포트) > 언론 > 커뮤니티 > 학술 논문 순으로 신뢰도를 둡니다. primary source 가 있으면 우선 인용하고, 부족하면 언론·커뮤니티로 보완합니다.
- 매체명은 입력 항목의 \`[매체명]\` 을 그대로 사용합니다.

[필수 출력 구조]
1. \`# 🗞 데스크 리서치 요약\` — 키워드와 수집 기간을 표지에 표기합니다 (한 줄).
2. 그 다음 **아래 5개 카테고리 섹션을 이 순서대로** 작성합니다. 단, **입력 항목 목록에 자료가 있는 카테고리만** heading 을 냅니다 (자료가 0건인 카테고리는 heading 자체를 생략 — 빈 섹션을 만들지 않습니다):
   \`## 📰 뉴스·포털 요약\`
   \`## 💬 커뮤니티 요약\`
   \`## 📊 시장 통계 요약\`
   \`## 🎓 학술·논문 요약\`
   \`## 🏛 산하 연구소 요약\`
   - 각 카테고리 안 = **불릿 리스트 3~8개**. 자료가 많으면 핵심만 압축하고, 적으면 있는 만큼만 작성합니다.
   - 각 불릿 = 하나의 claim/사실 + inline citation. 같은 카테고리 안에서 교차 검증되는 내용은 통합하고, 상충하면 함께 짚습니다.
   - 요청 언어가 영어이면 카테고리 heading 을 영어로 번역하되 이모지는 그대로 둡니다 (예: \`## 📰 News & Portals\`).
3. \`## ⚠️ 한계 / 추가 조사 제안\` — 3~5개 불릿. 데이터 부족 영역, 편향 가능성, 후속 리서치 아이디어를 적습니다 (이 섹션은 인용 없이 작성해도 됩니다).

분량은 충실하게 작성하되 불필요하게 늘리지 않으며, 각 불릿은 의미 있는 정보가 담길 때만 둡니다.${ISOLATION_NOTICE}`;

export async function runCustom(
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  const { keywords, usableSources, regions, range, locale } = input;
  // 단일 region 만 받는 다운스트림 (region-무관 source crawl) 용 representative.
  const primaryRegion: DeskRegion = regions[0] ?? 'KR';

  return {
    mode: 'custom',
    // 커스텀 mode 는 유저가 소스·키워드를 직접 지정하므로 AI 자동 선정·부정
    // filter·축 설계 같은 "판단" 이 없다 — 트렌드처럼 근거를 나열할 게 없다.
    // 그래서 판단 로그는 결정 2 대로 "이 mode 는 유저 지정 flow 라는 사실" +
    // "실제 사용한 소스 목록" 2줄만 최소로 남긴다. usableSources 는 env 필터
    // 를 이미 통과한(= 실제 crawl 되는) 소스라 그대로 신뢰한다.
    buildJudgmentEvents: () => {
      const sourceList = usableSources.length
        ? usableSources.map(sourceLabelKo).join(' · ')
        : '(지정된 소스 없음)';
      return [
        `🎯 커스텀 mode — 유저가 지정한 소스·키워드로 수집합니다 (AI 자동 선정·필터 없음).`,
        `📰 유저 지정 소스 = ${sourceList}`,
      ];
    },
    buildCrawlTasks: ({ similar }) => {
      const allKeywords = [...keywords, ...similar];
      // 멀티 region 시 region-aware source (google_news/gdelt/youtube) 는
      // region 마다 별도 crawl, 나머지 (naver/kakao/reddit/hn) 는 한 번만.
      const targets: { src: DeskSourceId; region: DeskRegion }[] = [];
      for (const src of usableSources) {
        if (REGION_AWARE_SOURCES.has(src)) {
          for (const r of regions) targets.push({ src, region: r });
        } else {
          targets.push({ src, region: primaryRegion });
        }
      }
      const tasks: CrawlTask[] = [];
      for (const kw of allKeywords) {
        for (const { src, region } of targets) {
          tasks.push({ source: src, keyword: kw, region });
        }
      }
      return tasks;
    },
    reportSystem: REPORT_SYSTEM,
    buildReportUserMsg: (ctx: ReportContext) => {
      const { sampled, articles, similar } = ctx;
      const grouped = new Map<DeskUiCategory, typeof sampled>();
      for (const a of sampled) {
        const cat = uiCategoryOf(a.source);
        const bucket = grouped.get(cat);
        if (bucket) bucket.push(a);
        else grouped.set(cat, [a]);
      }

      let itemIdx = 0;
      const categoryBlocks = UI_CATEGORY_ORDER.filter(
        (c) => (grouped.get(c)?.length ?? 0) > 0,
      ).map((c) => {
        const items = grouped.get(c) ?? [];
        const body = items
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
        return `=== ${UI_CATEGORY_HEADING[c]} (${items.length}건) ===\n${body}`;
      });

      return [
        `요청 언어: ${locale === 'ko' ? '한국어' : 'English'}`,
        `메인 키워드: ${keywords.join(', ')}`,
        `유사 키워드: ${similar.length ? similar.join(', ') : '(없음)'}`,
        `검색 지역: ${regions.join(', ')}`,
        `수집 기간: ${range.from || range.to ? `${range.from ?? '전체'} ~ ${range.to ?? '오늘'}` : '제한 없음'}`,
        `전체 수집: ${articles.length}건 (이 중 의미가 다양한 ${sampled.length}건을 본문에 첨부)`,
        '',
        '--- 항목 목록 (카테고리별로 그룹핑됨 — 이 카테고리 순서·구획을 그대로 리포트 heading 으로 사용하세요) ---',
        categoryBlocks.join('\n\n'),
      ].join('\n');
    },
  };
}
