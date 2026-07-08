-- 공유 링크 backend — shared_views + shared_view_invites (이메일 초대 게이트).
--
-- 배경: 인터뷰 결과(탑라인)·프로빙(페르소나) 전체보기 메인 패널을 외부
-- 링크로 공유하되, 동시통역 공개 공유(translate_sessions.share_token)와
-- 달리 *완전 공개가 아니라* 초대된 이메일만 열람하는 allow-list 게이트를
-- 둔다. 이 마이그는 backend(스키마)만 — 뷰어 라우트/렌더/관리 UI 는 후속
-- PR (#475/#476/#477).
--
-- 사용자 확정 결정(2026-07-08):
--   1. shared_views + invites 스키마 + unguessable 토큰 — 완전공개 X.
--   2. revoke(revoked_at) + 만료(expires_at) 필수 — 즉시 무효 + 기본 만료.
--   3. scope 한정 — interview_topline / probing_persona 두 리소스만.
--
-- RLS: 생성자(created_by) 또는 조직 admin 이 자기 share·invite 관리. 뷰어
-- 열람은 이 정책을 우회하는 서버 라우트(service_role)가 이메일 게이트를
-- 통과시킨 뒤 resource 를 돌려준다 (#475). 그래서 anon/viewer 용 select
-- 정책은 두지 않는다 — 토큰만 안다고 RLS 로 읽히면 안 되기 때문.
--
-- Realtime 불요 — 공유 링크는 status 실시간 전이가 없다 (§7.8 해당 없음).

------------------------------------------------------------------------
-- 1) shared_views — 공유 링크 1건 = 1 row.
------------------------------------------------------------------------

create table if not exists public.shared_views (
  id uuid primary key default gen_random_uuid(),
  -- URL-safe unguessable 토큰 (API 가 crypto.randomBytes 로 21자 발급).
  -- 링크 자체는 토큰만으로 접근되지만, 열람은 이메일 게이트가 최종 결정.
  token text not null unique,
  -- scope 한정 — 이 두 타입만 허용. 자유검색 등 다른 리소스는 공유 대상 X.
  resource_type text not null
    check (resource_type in ('interview_topline', 'probing_persona')),
  -- resource_id 는 resource_type 에 따라 다른 테이블을 가리킨다:
  --   interview_topline → public.interview_toplines.id
  --   probing_persona   → public.probing_sessions.id
  -- 서버 라우트(#475)가 resource_type 로 분기해 로드. 여기서는 FK 를 걸지
  -- 않는다(polymorphic) — org_id 로 소유권을 고정하고, 원본 삭제 시 공유가
  -- dangling 돼도 게이트는 여전히 안전(뷰어 라우트가 not_found 반환).
  resource_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  -- 만료 — null 이면 무기한이지만 API 는 기본값(예: 30일)을 항상 채운다.
  expires_at timestamptz,
  -- revoke — non-null 이면 즉시 무효. 게이트가 최우선으로 검사.
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shared_views_org_creator_idx
  on public.shared_views (org_id, created_by, created_at desc);

-- 리소스별 활성 공유 조회(관리 UI + 중복 방지 참고).
create index if not exists shared_views_resource_idx
  on public.shared_views (resource_type, resource_id);

alter table public.shared_views enable row level security;

-- 생성자 또는 조직 admin 만 select. anon/viewer 정책 없음 → 서버
-- 라우트(service_role)만 토큰으로 열람.
drop policy if exists "shared_views_select_owner_or_admin" on public.shared_views;
create policy "shared_views_select_owner_or_admin" on public.shared_views
  for select using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

-- 생성은 org member 이상 + 본인이 created_by 여야. resource 의 org 소유권은
-- API 가 (org-scoped 리소스 조회로) 별도 검증한다.
drop policy if exists "shared_views_insert_member" on public.shared_views;
create policy "shared_views_insert_member" on public.shared_views
  for insert with check (
    created_by = auth.uid() and public.has_org_role(org_id, 'member')
  );

-- revoke(update) 는 생성자 또는 admin.
drop policy if exists "shared_views_update_owner_or_admin" on public.shared_views;
create policy "shared_views_update_owner_or_admin" on public.shared_views
  for update using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

drop policy if exists "shared_views_delete_owner_or_admin" on public.shared_views;
create policy "shared_views_delete_owner_or_admin" on public.shared_views
  for delete using (
    created_by = auth.uid() or public.has_org_role(org_id, 'admin')
  );

------------------------------------------------------------------------
-- 2) shared_view_invites — 초대 이메일 allow-list.
--
-- 이메일은 정규화(lower/trim)해서 저장 — 게이트 비교가 대소문자 무관.
-- (shared_view_id, email) UNIQUE 로 중복 초대는 no-op(23505).
------------------------------------------------------------------------

create table if not exists public.shared_view_invites (
  id uuid primary key default gen_random_uuid(),
  shared_view_id uuid not null
    references public.shared_views(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (shared_view_id, email)
);

create index if not exists shared_view_invites_view_idx
  on public.shared_view_invites (shared_view_id);

-- 게이트가 email 로 조회하므로 조회 인덱스.
create index if not exists shared_view_invites_email_idx
  on public.shared_view_invites (email);

alter table public.shared_view_invites enable row level security;

-- invite 관리 권한은 부모 shared_view 를 관리할 수 있는지에 종속.
-- 부모가 select 가능(생성자 or admin)하면 그 invite 도 select 가능.
drop policy if exists "shared_view_invites_select_via_parent" on public.shared_view_invites;
create policy "shared_view_invites_select_via_parent" on public.shared_view_invites
  for select using (
    exists (
      select 1 from public.shared_views sv
      where sv.id = shared_view_id
        and (sv.created_by = auth.uid() or public.has_org_role(sv.org_id, 'admin'))
    )
  );

drop policy if exists "shared_view_invites_insert_via_parent" on public.shared_view_invites;
create policy "shared_view_invites_insert_via_parent" on public.shared_view_invites
  for insert with check (
    exists (
      select 1 from public.shared_views sv
      where sv.id = shared_view_id
        and (sv.created_by = auth.uid() or public.has_org_role(sv.org_id, 'admin'))
    )
  );

drop policy if exists "shared_view_invites_delete_via_parent" on public.shared_view_invites;
create policy "shared_view_invites_delete_via_parent" on public.shared_view_invites
  for delete using (
    exists (
      select 1 from public.shared_views sv
      where sv.id = shared_view_id
        and (sv.created_by = auth.uid() or public.has_org_role(sv.org_id, 'admin'))
    )
  );
