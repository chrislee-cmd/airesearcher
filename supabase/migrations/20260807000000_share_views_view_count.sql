-- 공유 링크 열람 집계 — shared_views 에 view_count + last_viewed_at 추가.
--
-- 배경(pr-share-mine-enrich-views · 공유 관리 대시보드 선행 BE): 관리 대시보드
-- 가 링크별 "N회 열람 / 마지막 열람 시각" 을 보여줄 수 있도록 집계 컬럼을 둔다.
-- **개별 열람자 신원 로그는 만들지 않는다**(PII 최소화, CD 핸드오프 §5-2 확정) —
-- count + last_viewed_at 두 값만.
--
-- write 경로: 뷰어 게이트(assertInvitedViewer) 통과 후 렌더 시점에 서버(뷰어
-- 페이지, service_role admin)가 increment_shared_view() 를 호출. 새로고침 남발에
-- 따른 과도집계는 허용(정밀 dedupe 범위 밖) — 게이트 실패는 카운트하지 않는다.
--
-- RLS: 신규 컬럼도 기존 shared_views 정책을 그대로 상속한다. increment 는
-- security-definer 함수를 통해 service_role 만 실행하도록 grant 를 좁힌다 —
-- 클라이언트(anon/authenticated)는 이 함수로 카운트를 조작할 수 없다.

------------------------------------------------------------------------
-- 1) 집계 컬럼 (additive, idempotent).
------------------------------------------------------------------------

alter table public.shared_views
  add column if not exists view_count int not null default 0;

alter table public.shared_views
  add column if not exists last_viewed_at timestamptz;

------------------------------------------------------------------------
-- 2) 원자적 increment 함수.
--
-- read-modify-write 레이스를 피하려 SQL 식(view_count + 1)으로 한 번에 갱신.
-- security definer + search_path 고정. service_role 만 실행 가능하게 grant 를
-- 좁혀, 클라이언트가 임의로 열람수를 부풀리지 못하게 한다(서버 게이트 경로만
-- 호출). 존재하지 않는 id 는 no-op(0 rows) — 에러 없이 조용히 통과.
------------------------------------------------------------------------

create or replace function public.increment_shared_view(p_share_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shared_views
  set view_count = view_count + 1,
      last_viewed_at = now()
  where id = p_share_id;
$$;

revoke all on function public.increment_shared_view(uuid) from public;
revoke all on function public.increment_shared_view(uuid) from anon;
revoke all on function public.increment_shared_view(uuid) from authenticated;
grant execute on function public.increment_shared_view(uuid) to service_role;
