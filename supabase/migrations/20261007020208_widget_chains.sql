-- 위젯 연쇄 체인 — widget_chains 인스턴스 테이블 (체인 파일럿 기반층, PR-A).
--
-- 분리된 위젯(프로빙 → 전사록 → 인터뷰 분석 → 탑라인 보고서)을 하나의 연쇄
-- 실행으로 묶는다. 이 마이그는 **데이터 모델만** — 소비자(advance 훅·UI)는
-- 후속 PR(B·C·D). 체인을 "고정 템플릿의 인스턴스"로 모델링하되, 단계 정의
-- 자체(DAG)는 코드 상수 레지스트리(`src/lib/chains/registry.ts`)에 두어 순환·
-- 무한 체인을 원천 차단한다. DB 에는 인스턴스(진행 상태)만 영속한다.
--
-- 사용자 확정 결정(2026-10-07, 점검 보고서 §6-A):
--   1. 기본 모드 = 단계별 승인(approve) — 크레딧 사전 고지. auto 는 명시 opt-in.
--      (2026-07-13 #1024 auto-kick 제거 "원치 않는 Opus 자동 과금" 의 해독제.)
--   2. 단계 정의 = 정적 DAG 레지스트리(코드). DB 는 인스턴스만.
--   3. 모든 상태 전이 = 멱등 CAS (라우트/훅 레이어에서 `eq('status', expected)`).
--   4. 프로젝트당 활성 체인 1개 — partial unique index (리스크 R7 동시성 가드).
--
-- RLS 는 org 스코프(has_org_role) — interview_toplines 마이그(20260706114519)와
-- 동일 컨벤션. 생성 write 는 보통 서버(admin client)가 하지만, 후속 UI 의 일반
-- client select/생성을 위해 viewer/member 정책을 둔다.
--
-- additive only — DESTRUCTIVE_RE(drop/alter type/rename/truncate/delete) 비대상
-- 이라 머지 시 apply-migrations 자동 적용 대상이다(#1262 수동적용 사태 재발 금지).

create table if not exists public.widget_chains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- interviews 프로젝트 귀속. 프로빙 진입 시 1단계에서 선택/생성하므로 체인
  -- 생성 시점엔 null 일 수 있다(스코프 매핑 R8). interview_projects 에 FK 를
  -- 걸지 않는 이유: 프로빙 세션은 project 에 선귀속되지 않아 느슨한 참조가 필요.
  project_id uuid,
  -- auth.users — 체인을 시작한 사용자. FK 미설정(사용자 삭제가 체인 영속을
  -- 막지 않도록, 감사 식별자로만 보존).
  created_by uuid not null,
  -- 승인 모드. 기본 approve(결정 1). auto 는 생성 시 명시 opt-in.
  mode text not null default 'approve' check (mode in ('approve', 'auto')),
  -- 정적 레지스트리 키(CHAIN_TEMPLATES). 파일럿: 'interview_pipeline'.
  template text not null,
  -- 단계 인스턴스 배열. 원소 shape:
  --   { feature, status, job_ref, cost_at_creation }
  -- feature = FeatureKey(FEATURE_COSTS 조회용, topline 은 무과금이라 null).
  -- status = pending|awaiting_approval|running|done|skipped|error.
  -- job_ref = 해당 단계가 kick 한 위젯 job id(B 가 채움). cost_at_creation =
  -- 생성 시점 표시 비용 스냅샷(가격 변동 대비, 표시용).
  steps jsonb not null,
  -- 진행 커서 — steps 내 현재 단계 인덱스.
  current_step int not null default 0,
  status text not null default 'running'
    check (status in (
      'running',
      'awaiting_approval',
      'done',
      'error',
      'cancelled',
      'paused_insufficient_credits'
    )),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 동시성 가드(R7) — 프로젝트당 "활성" 체인 1개. 활성 = 아직 종결되지 않은
-- 상태(running / awaiting_approval / paused). project_id 가 null 인 체인(프로빙
-- 진입 직후 미귀속)은 이 제약 밖 — null 은 unique index 에서 서로 충돌하지
-- 않으므로 자연히 제외된다. 종결 상태(done/error/cancelled)는 조건에서 빠져
-- 같은 프로젝트에 새 체인을 다시 시작할 수 있다.
create unique index if not exists widget_chains_one_active_per_project
  on public.widget_chains (project_id)
  where status in ('running', 'awaiting_approval', 'paused_insufficient_credits');

-- org 스코프 조회(활성 체인 목록) + RLS 정책 컬럼 인덱스.
create index if not exists widget_chains_org_idx
  on public.widget_chains (org_id, updated_at desc);

-- GET /api/chains?project_id= 활성 조회 경로.
create index if not exists widget_chains_project_idx
  on public.widget_chains (project_id);

alter table public.widget_chains enable row level security;

-- org 멤버는 select 가능(후속 UI 렌더/배너). 생성은 member, update(승인/전이)는
-- member, delete 는 admin. interview_toplines 정책 컨벤션 미러. 서버(admin
-- client)는 RLS 를 우회하지만, 일반 client 경로(UI)를 위해 정책을 둔다.
drop policy if exists "wc_select_member" on public.widget_chains;
create policy "wc_select_member" on public.widget_chains
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "wc_insert_member" on public.widget_chains;
create policy "wc_insert_member" on public.widget_chains
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "wc_update_member" on public.widget_chains;
create policy "wc_update_member" on public.widget_chains
  for update using (public.has_org_role(org_id, 'member'));

drop policy if exists "wc_delete_admin" on public.widget_chains;
create policy "wc_delete_admin" on public.widget_chains
  for delete using (public.has_org_role(org_id, 'admin'));

-- updated_at auto-bump.
create or replace function public.widget_chains_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists widget_chains_updated_at on public.widget_chains;
create trigger widget_chains_updated_at
  before update on public.widget_chains
  for each row execute function public.widget_chains_set_updated_at();

-- Realtime — UI(D)가 체인 status/current_step 전이를 postgres_changes 로
-- 구독한다. publication 에 안 붙이면 채널이 조용히 이벤트를 못 받는다
-- (PROJECT.md §7.8).
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'widget_chains'
  ) then
    alter publication supabase_realtime add table public.widget_chains;
  end if;
end $$;
