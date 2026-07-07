// 인터뷰 RAG 평가 하네스 — 공유 타입.
//
// 4 메트릭 = Recall@K / Coverage / Faithfulness / Citation. 각 메트릭은
// "몇 개 중 몇 개" 원자료(분모/분자)를 함께 실어 delta 비교 시 비율뿐 아니라
// 표본 크기 변화도 보이게 한다. 개별 메트릭 실패 시 그 필드는 null (부분 run
// 보존 — run-eval.ts 참고).

// 자동 생성된 정답(gold) 1건: 원본 청크 id + 그 청크로만 답 가능한 질문.
export type GoldQuestion = {
  chunk_id: number;
  document_id: string;
  question: string;
};

// 1. Retrieval Recall@K — self-consistency. gold 질문으로 검색했을 때 원본
//    청크가 top-K 안에 되돌아오는 비율.
export type RecallMetric = {
  k: number;
  sampled: number; // 실제 평가에 쓴 gold 질문 수
  hits: number; // 원본 청크가 top-K 에 잡힌 수
  recall_at_k: number; // hits / sampled
  mrr: number; // mean reciprocal rank (0 = 한 번도 못 잡음)
};

// 2. Respondent Coverage — 집계형 질문 검색 결과가 커버하는 고유 문서 비율.
export type CoverageMetric = {
  queries: number; // 실행한 집계형 질문 수
  total_docs: number; // 프로젝트 전체 문서 수
  cited_docs: number; // 검색 결과가 커버한 고유 문서 수(합집합)
  coverage: number; // cited_docs / total_docs
};

// 3. Faithfulness — 생성 답변의 claim 중 인용 근거로 뒷받침되는 비율.
export type FaithfulnessMetric = {
  claims: number;
  supported: number;
  faithfulness: number; // supported / claims
};

// 4. Citation Validity — 답변 인용 chunk_id 가 실재 + 내용 정합인 비율.
export type CitationMetric = {
  citations: number;
  valid: number;
  validity: number; // valid / citations
};

export type EvalMetrics = {
  recall: RecallMetric | null;
  coverage: CoverageMetric | null;
  faithfulness: FaithfulnessMetric | null;
  citation: CitationMetric | null;
};

// runEval 의 완전한 결과. store.ts 가 rag_eval_runs 로 영속한다.
export type EvalResult = {
  project_id: string;
  sample_size: number;
  k: number;
  model: string;
  git_sha: string;
  metrics: EvalMetrics;
  // 메트릭별 경고/스킵 사유 (예: "no_chunks", "coverage_skipped_single_doc").
  notes: string[];
};

// rag_eval_runs row (server-side shape).
export type RagEvalRun = {
  id: string;
  org_id: string;
  project_id: string;
  run_by_email: string;
  git_sha: string;
  sample_size: number;
  k: number;
  model: string;
  metrics: EvalMetrics;
  created_at: string;
};
