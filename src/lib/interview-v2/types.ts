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
