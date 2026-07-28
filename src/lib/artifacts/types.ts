// Artifact 통합(narrow-waist) — 봉투 read-model 타입.
//
// 6기능(프로빙·통역·전사록·AI UT·데스크·리크루팅)의 산출물 하류를 하나의
// 공통 계약("봉투")으로 통일하기 위한 SSOT. 이 파일은 통합 리스트 API
// (GET /api/artifacts)가 반환하는 행의 shape 만 정의한다 — 물리 테이블이
// 아니라 각 기능 테이블을 union 한 read-model 이다.
//
// 계약을 여기서 못박고 registry.ts 의 각 adapter.toRow 가 자기 기능 행을
// 이 shape 로 투영한다. CD 통합 라이브러리 UI 는 이 타입을 데이터 소스로 삼는다.

// Phase 1 — 1급 산출물(리스팅 가능)을 가진 기능.
// 후속: 'probing' | 'translate' 는 persist PR 후 편입.
export type DeliverableFeature = 'transcript' | 'desk' | 'ut' | 'recruiting';

// 기능별 상태 enum 을 정규화한 4-state. UI 는 이 4개만 알면 된다
// (신규 kind 가 추가돼도 프론트 무변경 — 정규화가 서버 책임).
export type DeliverableStatus = 'draft' | 'processing' | 'ready' | 'error';

// 통합 리스트 API 가 반환하는 봉투 행. 기능 고유 필드는 절대 최상위에 올리지
// 말 것 — 전부 `meta`(탈출구)로. 표시용 배지는 서버가 `meta_display` 로
// 포맷해 내려주므로 클라이언트에 per-kind 포맷터가 필요 없다.
export type DeliverableRow = {
  feature: DeliverableFeature; // 기능 키
  id: string; // feature_id = 해당 기능 테이블의 row id (recruiting=form_id string)
  kind: string; // 'transcript' | 'desk_report' | 'ut_insight' | 'recruiting_form'
  title: string; // 사람이 읽는 제목 (기능별 파생 — 파일명/키워드/타깃URL/폼제목)
  status: DeliverableStatus; // 정규화된 상태 (기능별 enum → 4-state)
  project_id: string | null;
  folder_id: string | null;
  created_at: string; // ISO
  updated_at: string; // ISO (소스에 없으면 created_at 폴백)
  shareable: boolean; // 공유링크 지원 여부 (shared_views 편입 여부)
  export_formats: string[]; // ['docx','pdf','srt'] 등 (없으면 [])
  meta: Record<string, unknown>; // 기능 고유 조각 탈출구 (duration/speakers/theme_count 등)
  meta_display: string[]; // 서버 포맷된 표시 배지 (예: ["64 min","2 speakers"])
  progress: number | null; // 0~1, processing 일 때만. 없으면 null → UI 는 %없이 렌더
};

// 통합 리스트 API 응답 봉투.
export type DeliverableListResponse = {
  rows: DeliverableRow[];
  next_cursor: string | null;
  // CD 필터 레일 카운트용. 페이지네이션(limit/cursor)과 무관하게 전체 스코프
  // 기준으로 서버가 계산. 각 facet 은 자기 차원을 제외한 나머지 필터만 적용
  // (표준 faceted-search 의미 — status 레일은 모든 status 카운트를 보여준다).
  facets: {
    by_feature: Record<string, number>;
    by_status: Record<string, number>;
  };
};
