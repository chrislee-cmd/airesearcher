-- 캔버스 전환 온보딩 — 팔레트 말풍선을 **사용자 단위로 1회만** 띄우기 위한 플래그.
--
-- 배경 (canvas-modular/full/README.md §8 · 장면 P4): 그리드 캔버스가 퇴역하고
-- 위젯이 왼쪽 팔레트로 옮겨 가므로, **그리드를 쓴 적 있는 사용자**에게만 첫
-- 진입에서 한 번 "위젯은 이제 왼쪽 목록에 있어요" 말풍선을 보여준다. 신규
-- 사용자에게는 보이지 않는다 — 빈 상태 문구가 같은 내용을 이미 말한다.
--
-- 왜 서버 플래그인가: §8 "어느 쪽이든 **사용자 단위 서버 플래그**를 기록하고,
-- 기기가 바뀌어도 다시 띄우지 않는다" + §11 Done-when "기기가 바뀌어도 재노출
-- 0". localStorage 로는 기기마다 다시 뜬다.
--
-- 저장 위치 = profiles.canvas_palette_onboarding. view_mode(20260714123432) ·
-- is_qa_tester(20260704051344) 와 동일한 유저 단위 additive 컬럼 패턴. RLS 는
-- 이미 존재하는 profiles_self_select / profiles_self_update 정책이 그대로
-- 커버한다(유저는 자기 row 만 read/write).
--
-- 값 3종:
--   'skip'    — 대상 아님(= 신규 사용자). 말풍선 미노출. **신규 row 기본값**.
--   'pending' — 대상자, 아직 안 봤음. 말풍선 1회 노출.
--   'done'    — 봤음(확인·Esc·타일 첫 조작 중 하나). 다시 노출 0.
--
-- 대상자 판정을 런타임 추론(세션 수·레이아웃 row 유무 등)으로 하지 않고 **이
-- 마이그 시점의 기존 row 를 'pending' 으로 채우는 것**으로 못박는다. 이 마이그가
-- 돌기 전에 가입해 있던 사용자 = 그리드 캔버스를 쓸 수 있었던 사용자이고, 이후
-- 가입자는 기본값 'skip' 이라 영원히 보지 않는다 — 판정이 결정적이고, 추론
-- 규칙이 나중에 흔들릴 여지가 없다.
alter table public.profiles
  add column if not exists canvas_palette_onboarding text not null default 'skip';

-- 값 집합 제약. 재실행 안전(존재하면 skip)하도록 guard.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_canvas_palette_onboarding_check'
  ) then
    alter table public.profiles
      add constraint profiles_canvas_palette_onboarding_check
      check (canvas_palette_onboarding in ('skip', 'pending', 'done'));
  end if;
end $$;

-- 기존 사용자 = 그리드 캔버스 사용자 → 1회 노출 대상. 신규 row 는 컬럼
-- 기본값 'skip' 이라 이 구문에 걸리지 않는다. 컷오프를 **이 마이그의 고정
-- 타임스탬프**로 못박아 멱등하게 만든다 — now() 로 두면 재실행 시 그 사이에
-- 가입한 신규 사용자까지 노출 대상으로 끌어온다.
update public.profiles
   set canvas_palette_onboarding = 'pending'
 where canvas_palette_onboarding = 'skip'
   and created_at < timestamptz '2026-10-12 04:25:23+00';
