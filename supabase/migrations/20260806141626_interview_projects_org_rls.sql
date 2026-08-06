-- 프로젝트 org 이전 (W1-A) — interview_projects 팀 공유화 (RLS 재설정).
--
-- 배경 (AUDIT-collab-storage-2026-08-06 §W1-A): interview_projects 는
-- 인터뷰·전사록·데스크·리크루팅이 공유하는 **프로젝트 컨테이너**다. 컨테이너의
-- RLS 가 "own project rw"(user_id = auth.uid()) 단독이라, org 에 팀원을 초대해도
-- 프로젝트 폴더가 목록/pill 에 안 보였다 — 내용물(interview_documents 등)은 이미
-- org viewer+ 공유인데 컨테이너만 개인 소유였다. 이 마이그가 그 컨테이너를 org
-- 역할 기반으로 열어 전 위젯 코워킹의 전제를 놓는다.
--
-- === 스펙 대비 실제 상태 (writer 진단 정정) ===================================
-- 스펙(pr-interview-projects-org-scope)은 "org_id 컬럼이 없다 → 추가 + 백필 +
-- not null" 을 요구했으나, 실제로는 org_id 가 **최초 스키마
-- (20260702074657_interview_v2_projects_and_queries.sql, #616) 부터
-- `not null references organizations(id)` 로 존재**한다. 따라서:
--   * 컬럼 추가 — 불필요(이미 존재).
--   * 백필 — 불필요(not null 제약이 모든 row 에 org_id 를 이미 보장).
--   * 생성 경로 org_id 세팅 — 앱 코드에 이미 있음(POST /api/interviews/v2/projects
--     이 org_id = getActiveOrg() 로 insert).
-- 남은 실제 갭 = RLS 재설정(개인 → org 역할) + 활성 목록 인덱스. 이 마이그는
-- 그 두 가지만 수행한다. 스키마(컬럼/FK/백필)는 손대지 않는다.
--
-- 백필 정합 검증(스펙 체크포인트 "null org_id 0건") — not null 제약으로 구조적
-- 보장. 확인 쿼리(참고, 실행 불필요):
--   select count(*) from public.interview_projects where org_id is null;  -- => 0
--
-- === RLS 모델 (스펙 §2, has_org_role 단조 포함: viewer<member<admin<owner) ====
--   * select      → has_org_role(org_id,'viewer') OR user_id = auth.uid()
--                   (org 멤버 누구나 열람. user_id 항은 전환 안전 belt —
--                    org 멤버십이 어긋난 자기 생성 row 도 항상 보이게.)
--   * insert      → has_org_role(org_id,'member') AND user_id = auth.uid()
--                   (쓰기 = member+. viewer 는 프로젝트 생성 불가.)
--   * update/del  → user_id = auth.uid() OR has_org_role(org_id,'admin')
--                   (생성자 본인 또는 org admin 만. 팀원이 남의 프로젝트를
--                    지우는 사고 방지 — 스펙 §2.)
--
-- org_id NULL 은 not null 제약상 발생 불가하나, has_org_role(NULL,...) 은 항상
-- false 라 설령 있어도 org 항으로는 거부된다(user_id 항으로만 도달 가능).
--
-- === 멱등성 / 롤백 =============================================================
-- 모든 문장은 additive/idempotent (enable RLS no-op · policy drop-if-exists 가드
-- · create index if not exists). destructive 패턴(drop table/column, alter type,
-- rename, truncate, delete) 없음 → merge-to-main 자동 적용(apply-migrations.yml)
-- 이 처리. `drop policy` 는 destructive 게이트 대상 아님(20260806123248 sched RLS
-- 선례 동일).
--
-- 롤백(수동, 필요 시): 아래 4개 org 정책을 drop 하고 원복 —
--   drop policy if exists "interview_projects_org_select" on public.interview_projects;
--   drop policy if exists "interview_projects_org_insert" on public.interview_projects;
--   drop policy if exists "interview_projects_org_update" on public.interview_projects;
--   drop policy if exists "interview_projects_org_delete" on public.interview_projects;
--   create policy "own project rw" on public.interview_projects
--     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
--   drop index if exists public.interview_projects_org_active_idx;

-- --- RLS enable (idempotent no-op — 테이블 생성 시 이미 enabled) ---------------
alter table public.interview_projects enable row level security;

-- --- 기존 개인 정책 제거 ------------------------------------------------------
-- "own project rw" (FOR ALL, user_id = auth.uid()) 를 역할별 정책으로 대체.
drop policy if exists "own project rw" on public.interview_projects;

-- --- org 역할 정책 -----------------------------------------------------------
drop policy if exists "interview_projects_org_select" on public.interview_projects;
create policy "interview_projects_org_select" on public.interview_projects
  for select using (
    public.has_org_role(org_id, 'viewer') or user_id = auth.uid()
  );

drop policy if exists "interview_projects_org_insert" on public.interview_projects;
create policy "interview_projects_org_insert" on public.interview_projects
  for insert with check (
    public.has_org_role(org_id, 'member') and user_id = auth.uid()
  );

drop policy if exists "interview_projects_org_update" on public.interview_projects;
create policy "interview_projects_org_update" on public.interview_projects
  for update using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  ) with check (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

drop policy if exists "interview_projects_org_delete" on public.interview_projects;
create policy "interview_projects_org_delete" on public.interview_projects
  for delete using (
    user_id = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- --- 활성 목록 인덱스 (스펙 §1: (org_id, archived_at) — 활성 목록 조회용) -----
-- 목록 조회가 user 필터 → org 필터로 바뀌므로(GET /api/interviews/v2/projects),
-- 지배 쿼리 = org_id = ? AND archived_at IS NULL ORDER BY updated_at DESC.
-- 기존 partial index 패턴(interview_projects_archived_idx: archived_at is null)
-- 을 org 축으로 확장 — org 활성 목록을 정렬까지 커버.
create index if not exists interview_projects_org_active_idx
  on public.interview_projects (org_id, updated_at desc)
  where archived_at is null;
