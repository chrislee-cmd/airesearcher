-- rag_eval_runs — 인터뷰 RAG 품질 평가 하네스의 스냅샷 저장소.
--
-- PR (interview-rag-eval-harness): 청킹/인덱싱/검색(A/B/C) 개선의 효과를
-- 정량 증명 + 회귀 방지하기 위한 4 메트릭 스냅샷. 한 run = 한 프로젝트에
-- 대한 (Recall@K / Coverage / Faithfulness / Citation) 측정 1회.
--
-- 전후 비교 = 같은 project_id 의 직전 run 대비 delta. git_sha 로 어느 배포
-- (=어느 A/B/C 단계)에서 측정했는지 추적 → baseline 고정 후 각 개선 머지
-- 뒤 재측정해 개선/회귀를 수치로 본다.
--
-- metrics jsonb 모양 (src/lib/interview-eval/types.ts EvalMetrics 와 1:1):
--   {
--     "recall":       { "k": 10, "sampled": 50, "hits": 43, "recall_at_k": 0.86, "mrr": 0.72 },
--     "coverage":     { "total_docs": 12, "cited_docs": 5, "coverage": 0.42, "queries": 3 },
--     "faithfulness": { "claims": 18, "supported": 15, "faithfulness": 0.83 },
--     "citation":     { "citations": 20, "valid": 19, "validity": 0.95 }
--   }
-- 개별 메트릭이 실패/스킵되면 그 키는 null (부분 run 도 보존 — 나머지는 유효).

create table if not exists public.rag_eval_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.interview_projects(id) on delete cascade,
  -- 하드코딩 super-admin gate (src/lib/admin/superadmin.ts) 를 통과한 이메일.
  -- 감사 목적 — 누가 언제 어느 프로젝트를 측정했는지.
  run_by_email text not null,
  -- 배포 git SHA (Vercel VERCEL_GIT_COMMIT_SHA). 로컬/미주입 시 'local'.
  git_sha text not null default 'local',
  -- 재현성 파라미터 — 같은 (project, sample_size, k) 면 같은 표본 축을 탄다.
  sample_size int not null,
  k int not null,
  -- 질문 생성 + 판사에 쓴 LLM 모델 (기본 claude-sonnet-4-6).
  model text not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

-- 전후 비교 조회 패턴: 특정 프로젝트의 created_at desc 최신 N건.
create index if not exists rag_eval_runs_project_created_idx
  on public.rag_eval_runs (project_id, created_at desc);

-- RLS 를 켜되 정책을 두지 않는다 = anon / authenticated 전부 거부, 오직
-- service_role 만 접근. admin_usage_snapshots 와 동일한 설계 —
-- super-admin gate 는 DB row/JWT 가 아니라 코드(isSuperAdminEmail)에서만
-- 판정하고, 모든 접근은 gate 를 통과한 API route 의 service-role client 로만
-- 이뤄진다. 실수로 프로필 row 편집 등으로 접근이 새는 경로를 원천 차단.
alter table public.rag_eval_runs enable row level security;
