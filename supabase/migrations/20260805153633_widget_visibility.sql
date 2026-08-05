-- widget_visibility — 캔버스 위젯의 "일반 유저 노출" 전역 플래그.
--
-- PR (widget-visibility-admin-toggle): src/lib/canvas/visibility.ts 의 하드코딩
-- CANVAS_VISIBILITY 맵을 DB 로 옮긴다. 지금까지 위젯 노출을 바꾸려면 코드
-- 배포가 필요했다("PR3 에서 db 연동 예정" 주석의 그 PR). 이 테이블이 그 소스가
-- 되어 슈퍼어드민이 /admin/widget-visibility 토글로 즉시 반영한다.
--
-- 모델:
--   - widget_key = CanvasWidgetKey (recruiting/desk/... — visibility.ts SSOT).
--   - visible    = 일반(비-슈퍼어드민) 유저에게 노출할지. 슈퍼어드민은 항상 전부
--                  본다(코드에서 우회, off 위젯엔 "숨김" 뱃지) — 이 플래그 무관.
--   - 행이 없는 키는 코드 기본값(CANVAS_VISIBILITY)으로 fallback → 신규 위젯을
--     추가해도 마이그 불요. 조회 실패해도 코드 기본값으로 렌더(캔버스 안 깨짐).
--
-- 경계: 전역 플래그만 — org/유저 단위 세분화 없음(후속). 기능 API/데이터 차단은
-- 하지 않는다(노출 제어만). 슈퍼어드민 검증은 write API 서버측에서.

create table if not exists public.widget_visibility (
  widget_key text primary key,
  visible boolean not null default true,
  updated_at timestamptz not null default now(),
  -- 마지막으로 토글한 슈퍼어드민(감사용). auth.users 삭제 시 null 로 남겨 이력 보존.
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.widget_visibility enable row level security;

-- select 는 authenticated 전체 — 캔버스 렌더(서버 컴포넌트)가 요청당 1회 로드한다.
-- 노출 플래그 자체는 비밀이 아니고, 실제 기능 접근은 각 위젯 게이트가 담당한다.
drop policy if exists "widget_visibility_authenticated_select" on public.widget_visibility;
create policy "widget_visibility_authenticated_select" on public.widget_visibility
  for select to authenticated using (true);

-- write 정책은 두지 않는다 — 오직 service-role(어드민 API, 슈퍼어드민 서버 검증
-- 경유)만 upsert 한다. RLS 로 일반 유저의 직접 write 를 원천 차단.

-- Seed: 현행 CANVAS_VISIBILITY 값 그대로 옮기되 moderator_ai=false (#588 흡수 —
-- AI UT 를 일반 유저에게 기본 숨김). 재실행 안전(on conflict do nothing) — 이미
-- 슈퍼어드민이 토글한 값을 시드가 덮어쓰지 않는다.
insert into public.widget_visibility (widget_key, visible) values
  ('recruiting', true),
  ('desk', true),
  ('guideline', true),
  ('probing', true),
  ('translate', true),
  ('moderator_ai', false),
  ('quotes', true),
  ('interviews', true),
  ('ppt_report', true),
  -- 옛 숨김 3종 — 코드에서 이미 CANVAS_VISIBILITY=false. 토글 화면엔 미노출이고
  -- 되살리기는 코드 소관이지만, 시드는 "현행 값 그대로"라 함께 기록해 둔다.
  ('moderator', false),
  ('topline', false),
  ('slidegen', false)
on conflict (widget_key) do nothing;
