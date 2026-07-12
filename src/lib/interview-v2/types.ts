// 인터뷰 V2 도메인 타입 — DB schema
// (migration 20260702074657_interview_v2_projects_and_queries.sql) 에 대응.
//
// 이 PR 은 schema + 타입 정의만 담는다. 사용처(프로젝트 CRUD, 검색 UI/API)는
// 후속 V2 spec 에서 이 타입들을 import 한다.

/** interview_projects row — 인터뷰 문서 그룹 단위. */
export type InterviewProject = {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * interview_search_queries row — 검색 질의 + 답변 + citation 로그.
 * project_id = null 이면 cross-project 검색.
 */
export type InterviewSearchQuery = {
  id: string;
  project_id: string | null;
  question: string;
  answer_md: string | null;
  citations: Citation[] | null;
  created_at: string;
};

/**
 * 검색 답변이 인용한 청크 참조. interview_search_queries.citations (jsonb)
 * 배열의 원소 shape.
 */
export type Citation = {
  chunk_id: string;
  document_id: string;
  filename: string;
  project_name?: string;
  excerpt: string;
  score: number;
};

/**
 * 검색 답변에 딸린 구조화 산출물 (Phase 1 = 표 + 인용 리스트).
 * LLM 이 질문 신호를 보고 자율 판단해 answer_md 와 함께 스트림한다.
 * search-prompt.ts 의 searchAnswerSchema.artifacts 와 shape 를 맞춘다.
 */
export type TableArtifact = {
  type: 'table';
  title: string;
  headers: string[];
  rows: string[][];
  // row 별 응답자 id (server re-verify 용). client 렌더엔 안 쓰임.
  respondent_ids: string[];
};

export type QuoteListArtifact = {
  type: 'quote_list';
  title: string;
  quotes: Array<{
    respondent: string;
    quote: string;
    chunk_id: string;
  }>;
};

/**
 * 차트 산출물 (Phase 2 = bar/pie). "몇 %", "비율", "분포" 신호 +
 * 범주 3개 이상일 때 LLM 이 emit. series 별 count 는 server 가
 * respondent_ids 실 매칭 개수로 재계산한다 (route verifyArtifacts).
 */
export type ChartArtifact = {
  type: 'chart';
  title: string;
  chart_type: 'bar' | 'pie';
  series: Array<{
    label: string;
    count: number;
    // 각 category 근거 청크의 chunk_id (server re-verify 용).
    respondent_ids: string[];
  }>;
  description?: string;
};

export type SearchArtifact = TableArtifact | QuoteListArtifact | ChartArtifact;

/**
 * 탑라인 보고서 블록 (client-safe). 서버 `lib/interview-v2/topline.ts` 의
 * `ToplineBlock` 과 shape 를 맞추되, 그 파일은 admin client / AI SDK 를
 * import 하므로 client 컴포넌트가 쓰기엔 부적합해 여기 순수 타입만 둔다.
 *
 * blocks jsonb (migration 20260706114519) 원소:
 *   { id, type, md?, citations?, table?, attribution?, question? }
 * table 은 type='table' 일 때만, attribution 은 quote, question 은
 * inserted_qa(후속 drag-to-ask 병합) 에서만 채워진다. id 는 서버가 부여한
 * 안정 anchor (drag-to-ask DOM 계약 — data-block-id).
 */
export type ToplineBlockType =
  | 'executive_summary'
  | 'heading'
  | 'subheading'
  | 'paragraph'
  | 'insight'
  | 'quote'
  | 'table'
  | 'chart'
  | 'pie'
  | 'inserted_qa'
  // 섹션 사이 hover→+ 로 자연어 프롬프트를 주고 생성한 삽입 섹션. inserted_qa 와
  // 같은 "사용자 삽입" 계열이라 재생성에도 보존된다(topline.ts extractInsertedBlocks).
  | 'inserted_section';

/**
 * 인라인 텍스트 편집이 가능한 블록 타입 — 순수 텍스트(md)를 담는 것만. table/
 * chart/pie 는 구조 데이터라 제외(사용자 결정 3 — 텍스트 블록만 편집). client
 * (팝업의 편집 버튼 활성 판정)와 server(route 의 editBlockMd)가 이 한 벌을
 * 공유해 목록이 어긋나지 않게 한다.
 */
export const EDITABLE_TOPLINE_BLOCK_TYPES: ReadonlySet<ToplineBlockType> =
  new Set([
    'heading',
    'subheading',
    'paragraph',
    'insight',
    'quote',
    'inserted_qa',
    // 삽입 섹션도 순수 md 프로즈라 인라인 편집(edit_block) 대상.
    'inserted_section',
  ]);

/** 이 블록이 인라인 텍스트 편집 대상인지(md 를 교체할 수 있는지). */
export function isEditableToplineBlockType(type: ToplineBlockType): boolean {
  return EDITABLE_TOPLINE_BLOCK_TYPES.has(type);
}

/** chart/pie 블록의 데이터 포인트. */
export type ToplineChartDatum = { label: string; value: number };

export type ToplineBlock = {
  id: string;
  type: ToplineBlockType;
  md?: string;
  citations?: string[];
  attribution?: string;
  question?: string;
  // inserted_qa(drag-to-ask 병합) 에서만 — 사용자가 드래그로 선택한 원문
  // 발췌. Q 라벨에 문맥으로 표시된다.
  selected_excerpt?: string;
  // inserted_section 에서만 — 사용자가 준 자연어 지시(예: "취미 섹션 추가").
  // 섹션 라벨/디버깅 문맥용. 렌더는 md 프로즈가 담당.
  prompt?: string;
  table?: { headers: string[]; rows: string[][] };
  // executive_summary 블록 전용 — 리치 요약 문단 + 핵심 포인트 3~5. 카드
  // abstract 와 fullview 리드가 공용 소비(pr-interview-topline-executive-summary-field).
  summary?: string;
  key_points?: string[];
  // chart/pie 블록 전용 — 제목/종류/데이터/해설.
  title?: string;
  chartKind?: 'bar' | 'line';
  data?: ToplineChartDatum[];
  description?: string;
};

export type ToplineStatus = 'none' | 'idle' | 'generating' | 'done' | 'error';

/** GET /api/interviews/v2/topline 응답 shape (읽기 전용 조회). */
export type ToplineReadResult = {
  // interview_toplines.id — 공유 링크(#477)의 resource_id. 미생성이면 null.
  id: string | null;
  status: ToplineStatus;
  blocks: ToplineBlock[];
  stale: boolean;
  indexed: boolean;
  generated_at: string | null;
  model: string | null;
  error_message: string | null;
  // 마지막 생성에 쓰인 출력 언어(ko/en/ja/zh/es/th). null = 레거시/미생성 →
  // 클라이언트가 기본(한국어)으로 표시.
  output_lang: string | null;
  // 마지막 재생성에 쓰인 분석 방향(자유 텍스트). null = 방향 없음/레거시/미생성 →
  // 재생성 모달을 빈 입력으로 시작.
  user_direction: string | null;
  // map-reduce 진행률(전 문서 순회) — generating 중 "N/M 문서 분석". map_total 이
  // null 이면 진행률 미노출(레거시 또는 아직 map 시작 전).
  map_total: number | null;
  map_done: number | null;
  // row 의 마지막 갱신 시각(ISO). 살아 있는 생성은 map 진행/부분 블록 flush 마다
  // updated_at 트리거가 bump 한다. 이 값이 STALE 창을 넘긴 채 status='generating'
  // 이면 백그라운드 함수가 죽은 것 = stuck(카드 #483). null = 미생성.
  updated_at: string | null;
};

// 'generating' row 가 이 시간(ms)보다 오래 갱신 안 되면 백그라운드 생성 함수가
// 죽은 것(maxDuration 300s 타임아웃/크래시)으로 간주한다. maxDuration(300s) +
// 여유(60s) = 360s. 서버 on-read 정리(GET)와 클라 stuck 판정이 이 값을 공유해
// 판정을 정합시킨다(카드 #483). updated_at 은 map 진행·부분 블록 flush 마다
// 트리거로 bump 되므로, 살아 있는 생성은 이 창을 절대 넘기지 않는다.
export const TOPLINE_GENERATING_STALE_MS = 360_000;

/**
 * row 가 stuck 'generating' 인지 — status='generating' 인데 updated_at 이
 * STALE_MS 넘게 갱신 안 됐으면 true. 타임아웃(300s 킬)은 JS 미실행이라 runTopline
 * catch 가 status='error' 로 못 넘겨 영구 'generating' 에 갇히는데, 이 판정이
 * 재생성/추가질문 잠금 해제의 기준이 된다. 서버(on-read flip)·클라(재생성 활성)
 * 공용.
 */
export function isToplineGeneratingStale(
  row: { status: string; updated_at?: string | null } | null | undefined,
  nowMs: number,
): boolean {
  if (!row || row.status !== 'generating' || !row.updated_at) return false;
  const updated = Date.parse(row.updated_at);
  if (Number.isNaN(updated)) return false;
  return nowMs - updated > TOPLINE_GENERATING_STALE_MS;
}
