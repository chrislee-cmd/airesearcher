-- canvas_layout_publish — 슈퍼어드민이 발행한 /canvas 위젯 배치의 전역 SSOT.
--
-- 배경 (사용자 결정 2026-08-07): 지금까지 캔버스 위젯 배치(positions)는
-- localStorage per-user(canvas-board.tsx POSITIONS_STORAGE_KEY)가 유일한 소스라
-- 서버 저장이 0이었다. 슈퍼어드민이 캔버스에서 위젯을 드래그해 만든 배치를
-- "기본 배치로 발행"하면 그 레이아웃이 일반계정의 초기 렌더 baseline 이 된다.
--
-- 모델:
--   - key       = 단일 전역 발행 = 'global'(단일 row, unique). org 단위는 후속.
--   - positions = { "<widgetKey>": { "col": <int>, "row": <int> }, ... } jsonb.
--                 위젯 key 화이트리스트/그리드 범위/겹침 검증은 서버(발행 API +
--                 board hydrate)가 담당한다. 여기선 형태만 담는다.
--   - version   = 발행 세대. 발행할 때마다 ++. 일반계정은 localStorage 에 마지막
--                 적용 version 을 기록하고, 서버 version 이 더 높으면(=재발행)
--                 stale 로 보고 발행 레이아웃을 재적용한다.
--
-- 접근 경로: 읽기 = canvas/page.tsx 의 authenticated 서버 조회(select 정책),
-- 쓰기 = /api/admin/canvas-layout(슈퍼어드민 서버 게이트) service-role upsert.
-- (widget_visibility 와 동일 격리 모델 — select 는 authenticated, write 는
-- service-role 만.)

create table if not exists public.canvas_layout_publish (
  key text primary key,                              -- 단일 전역 = 'global'
  positions jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  published_at timestamptz not null default now(),
  -- 마지막으로 발행한 슈퍼어드민(감사용). auth.users 삭제 시 null 로 이력 보존.
  published_by uuid references auth.users(id) on delete set null
);

alter table public.canvas_layout_publish enable row level security;

-- select 는 authenticated 전체 — 캔버스 렌더(서버 컴포넌트)가 요청당 1회 로드한다.
-- 발행 배치는 비밀이 아니고, 실제 기능 접근은 각 위젯 게이트가 담당한다.
drop policy if exists "canvas_layout_publish_authenticated_select" on public.canvas_layout_publish;
create policy "canvas_layout_publish_authenticated_select" on public.canvas_layout_publish
  for select to authenticated using (true);

-- write 정책은 두지 않는다 — 오직 service-role(어드민 API, 슈퍼어드민 서버 검증
-- 경유)만 upsert 한다. RLS 로 일반 유저의 직접 write 를 원천 차단.
