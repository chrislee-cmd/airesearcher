-- /status 구성형 위젯 보드 — 공유 레이아웃 영속 저장소 (dashboard_layouts).
--
-- 배경 (사용자 결정 2026-07-12): /status 를 고정 카드 그리드에서 "구성형 위젯
-- 보드"로 전환한다. super-admin(chris)이 위젯을 드래그 이동 / span 리사이즈(1~3
-- 컬럼) / 추가·제거한 뒤 서버에 저장하면, 벽 모니터·폰·공개 토큰 URL 어디서 봐도
-- 동일한 "공유 레이아웃"이 렌더된다.
--
-- 단일 공유 레이아웃이면 충분하므로 과설계하지 않는다 — key='public-status' 단일
-- row 하나만 존재한다(unique). layout jsonb 는 위젯 배치 배열
--   { version:1, widgets:[{ id:'dau_wau', span:3 }, ...] }
-- 을 담는다(순서 = 표시 순서, span = 컬럼 span). 위젯 id 화이트리스트 검증은
-- 서버(src/lib/admin/dashboard-layout.ts + write API)가 담당한다.
--
-- 접근 경로: 읽기 = status/page.tsx 의 service-role RSC 조회, 쓰기 =
-- /api/admin/dashboard-layout(super-admin 게이트) upsert. 클라이언트가 이 테이블에
-- 직접 붙을 일이 없으므로 RLS 는 deny-all(정책 0개) — service-role 만 우회한다.
-- (admin-analytics 의 service-role-only 데이터 경로와 동일한 격리 모델.)

create table if not exists public.dashboard_layouts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,             -- 단일 공유 = 'public-status'
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- 조회는 항상 key='public-status' point-lookup — unique 제약이 인덱스를 제공하므로
-- 별도 인덱스 불필요.

alter table public.dashboard_layouts enable row level security;

-- 정책을 두지 않는다 → anon/authenticated 는 deny-all. 접근은 오직 service-role
-- (RSC 읽기 + super-admin 게이트 API 쓰기)로만. 공개 토큰만 아는 시청자가 client
-- 에서 이 테이블을 직접 write 해 공유 보드를 헝클 수 없다.

-- updated_at auto-bump — upsert(on conflict update) 시에도 최신 시각 유지.
create or replace function public.dashboard_layouts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dashboard_layouts_updated_at
  on public.dashboard_layouts;
create trigger dashboard_layouts_updated_at
  before update on public.dashboard_layouts
  for each row execute function public.dashboard_layouts_set_updated_at();
