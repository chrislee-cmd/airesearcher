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
  | 'heading'
  | 'paragraph'
  | 'insight'
  | 'quote'
  | 'table'
  | 'inserted_qa';

export type ToplineBlock = {
  id: string;
  type: ToplineBlockType;
  md?: string;
  citations?: string[];
  attribution?: string;
  question?: string;
  table?: { headers: string[]; rows: string[][] };
};

export type ToplineStatus = 'none' | 'idle' | 'generating' | 'done' | 'error';

/** GET /api/interviews/v2/topline 응답 shape (읽기 전용 조회). */
export type ToplineReadResult = {
  status: ToplineStatus;
  blocks: ToplineBlock[];
  stale: boolean;
  indexed: boolean;
  generated_at: string | null;
  model: string | null;
  error_message: string | null;
};
