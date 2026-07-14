-- 유저 뷰 선호 (캔버스 ⇄ 리스트) — 라이트/다크처럼 선호 뷰를 기기 간 동기.
--
-- 배경 (사용자 결정 2026-07-14): 공간형 캔버스 보드가 불편한 유저를 위해
-- "리스트 뷰"를 선택지로 추가한다. 캔버스 제거가 아니라 선호 뷰 토글이며,
-- 헤더 토글로 board ⇄ list 를 in-place 스왑하고 그 선호를 DB(유저 설정)에
-- 저장해 다음 방문·다른 기기에서도 마지막 선택 뷰로 진입한다.
--
-- 저장 위치 = profiles.view_mode. is_qa_tester 컬럼(20260704051344)과 동일한
-- 유저 단위 additive 컬럼 패턴. RLS 는 이미 존재하는 profiles_self_select /
-- profiles_self_update 정책이 그대로 커버(유저는 자기 row 만 read/write).
--
-- additive + default 'canvas' — 기존 유저는 값이 자동 'canvas' 라 캔버스 뷰로
-- 진입, 경험 불변. handle_new_user 트리거가 모든 유저에 profiles row 를 만들어
-- 두므로 신규 유저도 default 'canvas' 를 가진다.
alter table public.profiles
  add column if not exists view_mode text not null default 'canvas';

-- 값은 'canvas' | 'list' 만 허용. 재실행 안전(존재하면 skip)하도록 guard.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_view_mode_check'
  ) then
    alter table public.profiles
      add constraint profiles_view_mode_check
      check (view_mode in ('canvas', 'list'));
  end if;
end $$;
