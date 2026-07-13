// Desk orchestrator 공유 계약 — 2 mode (trend/market) 가 공유하는
// 타입·상수만 둔다. 이 파일은 client(모드 selector / AI 판단 로그)에서도
// import 되므로 server 전용 모듈(env, LLM, supabase)을 절대 import 하지 말 것.
//
// 소유권 (충돌 매트릭스): 이 파일은 shell PR(C) 이 완결한다. 후속 market(D)
// PR 은 자기 mode 파일(market.ts)만 편집하고 이 파일은 편집하지 않는다.
// (custom mode 는 제거됨 — fix/desk-remove-custom-mode.)

import type {
  DeskArticle,
  DeskDateRange,
  DeskRegion,
  DeskSourceErrorReason,
  DeskSourceId,
} from '@/lib/desk-sources';

export type DeskMode = 'trend' | 'market';

export const DESK_MODES: DeskMode[] = ['trend', 'market'];

// 국가 범위 (세부 옵션) — 소스 게이팅 + market 보고서 구조 분기의 SSOT.
//   'kr'     = 국내 자료만(KOSIS·DART·국내 뉴스). 글로벌 공시/매크로 소스 제외.
//              범위 개념이 없던 기존 동작과 동일 = 회귀 0. **default.**
//   'global' = 국내 + 글로벌 공시(SEC EDGAR·EDINET·e-Stat·World Bank·OECD).
//              market 보고서에 해외 섹션 + 국내 vs G7 대비 섹션/차트가 붙는다.
// client(desk-card-body)에서도 import 되므로 server 전용 모듈을 끌어오지 않는다.
export type DeskCountryScope = 'kr' | 'global';

export const DESK_COUNTRY_SCOPES: DeskCountryScope[] = ['kr', 'global'];

// 컨트롤 미선택/누락 시 기본값 — 현행(국내 only) 동작을 보존한다.
export const DEFAULT_COUNTRY_SCOPE: DeskCountryScope = 'kr';

// 아직 orchestrator 실 로직이 없는 mode 를 실행하려 할 때 던진다. route 의
// runner 가 이 에러를 잡아 크레딧 환불 + `not_implemented_yet:<mode>` 로
// 마무리한다 (일반 runtime_error 와 구분).
export class NotImplementedYet extends Error {
  readonly mode: DeskMode;
  constructor(mode: DeskMode) {
    super(`not_implemented_yet:${mode}`);
    this.name = 'NotImplementedYet';
    this.mode = mode;
  }
}

// 트렌드 mode 가 자동 선정하는 소스 세트 (뉴스·SNS·검색량 위주, 통계/공시
// 제외). client 의 검색 범위 견적도 이 목록 길이를 쓰므로 여기(client-safe)
// 에 둔다. spec 의 'web_search' 는 레지스트리에 별도 id 가 없어 카카오(다음)
// 웹문서 검색(kakao_web)으로 매핑.
export const TREND_SOURCE_IDS: DeskSourceId[] = [
  'google_news',
  'naver_news',
  'naver_blog',
  'naver_cafe',
  'youtube',
  'institutes_kr',
  'kakao_web',
];

// AI 판단 로그 이벤트 마커. orchestrator 가 push 하는 판단 이벤트는 반드시
// 이 마커 중 하나로 시작한다 — AiJudgmentLog 컴포넌트가 progress.events
// 안에서 판단 라인만 골라내는 유일한 기준.
export const JUDGMENT_EVENT_MARKERS = ['🎯', '🔍', '🧠', '📰', '🚫'] as const;

export function isJudgmentEvent(line: string): boolean {
  return JUDGMENT_EVENT_MARKERS.some((m) => line.startsWith(m));
}

// region 파라미터를 받는 소스 — 이들은 선택된 region 마다 별도 crawl 하고,
// 나머지(네이버/카카오 = KR 전용, Reddit/HN = region 무관)는 대표 region 으로
// 한 번만 crawl 한다. (옛 route.ts 의 REGION_AWARE_SOURCES 를 그대로 이관.)
export const REGION_AWARE_SOURCES = new Set<DeskSourceId>([
  'google_news',
  'gdelt_news',
  'youtube',
]);

// 한 번의 crawl 호출 단위. runner 는 mode 별 plan 이 돌려준 task 목록을
// 그대로 병렬 실행한다 — task 구성(어떤 소스·키워드 조합인지)이 mode 의
// 정체성이고, 실행(타임아웃/이벤트/예산)은 runner 공통.
export type CrawlTask = {
  source: DeskSourceId;
  keyword: string;
  region: DeskRegion;
};

export type OrchestratorInput = {
  keywords: string[];
  // trend/market: 서버가 정한 소스(env 필터 통과) — POST 단계에서 이미
  // resolve 되어 들어온다.
  usableSources: DeskSourceId[];
  locale: 'ko' | 'en';
  regions: DeskRegion[];
  range: DeskDateRange;
  // 국가 범위 — market 이 글로벌 소스 게이팅 + 보고서 구조 분기에 사용한다.
  // trend 은 글로벌 공시/매크로 소스를 쓰지 않으므로 이 값을 무시한다(회귀 0).
  countryScope: DeskCountryScope;
};

// 리포트 합성 시점에 mode 별 user 메시지를 만들기 위한 컨텍스트.
export type ReportContext = {
  locale: 'ko' | 'en';
  keywords: string[];
  similar: string[];
  regions: DeskRegion[];
  range: DeskDateRange;
  // dedupe 후 전체 풀 (≤1500) — 부정 filter bucket 추출 등 전수 조회용.
  articles: DeskArticle[];
  // 임베딩 샘플링을 거친 대표 subset — LLM 본문에 첨부되는 목록.
  sampled: DeskArticle[];
};

// mode 별 orchestrator 가 돌려주는 실행 계획. runner(route.ts)는 이 계획의
// 각 hook 을 공통 파이프라인(확장 → crawl → 안전망 → 샘플링 → 리포트 →
// 차트)의 해당 지점에서 호출한다. 새 mode 는 파일 하나(runX)만 추가/교체
// 하면 되고 runner 는 재편집하지 않는다.
export type OrchestratorPlan = {
  mode: DeskMode;
  // 소스별 검색어 재작성 결과(source-aware query rewrite). present 하면 runner
  // 는 이 mode 가 자연어를 이미 한 번의 LLM 호출로 구조화 파싱했다는 뜻 —
  // 일반 유사어 확장(expand)을 건너뛰고 `phrases` 를 similar 로 재사용한다.
  // trend 는 이 필드를 안 채워 기존 확장 경로를 그대로 탄다.
  parsed?: {
    phrases: string[];
    statTerms: string[];
    companies: string[];
    intent?: string;
  };
  // 키워드 확장 직후 · crawl 시작 전에 progress.events 로 push 되는 AI 판단
  // 로그 라인들. 각 라인은 JUDGMENT_EVENT_MARKERS 로 시작해야 한다.
  buildJudgmentEvents: (args: { similar: string[] }) => string[];
  // (원 키워드 + 유사 키워드) × 소스 × region 조합의 crawl task 목록.
  buildCrawlTasks: (args: { similar: string[] }) => CrawlTask[];
  // D 하이브리드 fallback 훅 — 1차 crawl 완료 후(dedupe·안전망 직전) runner 가
  // 호출한다. 구조화 축(공시·통계)이 실데이터 0(반환 article 이 전부 "사유
  // article"이거나 source error)일 때, 그 축의 원 쿼리(회사명/통계품목/원 키워드)를
  // web_search 로 보강할 2차 crawl task 를 돌려준다. runner 는 이 task 를 실행해
  // 결과를 근거 풀(collected)에 합류시키고(dedupe 에서 tier 자동 부여), events 를
  // 판단 로그(🔍 마커)로 push 한다.
  //   - 구조화 축에 실데이터가 있으면 tasks=[] → 미발동(과발동·불필요 비용 없음).
  //   - 웹서치 근거는 kind 미설정(수치 pin 대상 아님)이라 TAM/SAM·재무표·매출차트에
  //     편입되지 않는다 = 수치 ground-truth 격리가 코드로 보장된다.
  // 미설정이면(기본) fallback 없이 기존 경로 그대로 — trend 는 최소만 채운다.
  buildFallbackTasks?: (args: {
    collected: DeskArticle[];
    sourceError: Map<DeskSourceId, DeskSourceErrorReason>;
    similar: string[];
  }) => { tasks: CrawlTask[]; events: string[] };
  // LLM 리포트 합성 system prompt (mode 별 보고서 shape 강제).
  reportSystem: string;
  // LLM 리포트 합성 user 메시지 (수집 항목 첨부 형식은 mode 소유).
  buildReportUserMsg: (ctx: ReportContext) => string;
};
