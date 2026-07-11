-- Widget interest votes — 일반(비-unlimited) 계정에게 canvas 위젯 중 OPEN 셋
-- (probing/translate/quotes) 외의 위젯이 "준비중" 게이트로 렌더될 때, 사용자가
-- 그 위젯의 수요를 신호하는 휘발성 2버튼("빨리 만들어주세요" / "이건 굳이 없어도
-- 될것 같아요")을 누르면 이 테이블에 upsert 로 기록된다. 사장님이 (user_id,
-- widget_key) 단위로 수요를 집계 — 재투표는 덮어쓰기(같은 유저 한 위젯 = 최신 1표).
--
-- RLS 관례는 qa_feedbacks (20260704044952) 를 그대로 따른다: 유저는 자기 행만
-- insert/update/read, super-admin(chris.lee)은 전체 read. update 는 여기선 upsert
-- (on conflict) 경로 때문에 self_update 정책을 추가로 둔다 (qa_feedbacks 는
-- append-only 라 update 정책이 없었다).

-- ── Table ────────────────────────────────────────────────────────────────
create table if not exists public.widget_interest_votes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid,                                -- 활성 org (있으면 클라가 전달, nullable)
  widget_key  text not null,                       -- CanvasWidgetKey (recruiting/desk/…)
  vote        text not null check (vote in ('want', 'skip')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 유저 한 명이 한 위젯에 한 표 — upsert on conflict target.
  unique (user_id, widget_key)
);

-- 집계 조회용 — (widget_key, vote) 로 want/skip 카운트를 빠르게 그룹.
create index if not exists widget_interest_votes_key_vote_idx
  on public.widget_interest_votes (widget_key, vote);

-- keep updated_at honest (재투표 = 같은 row update → 최신 시각 반영).
create or replace function public.touch_widget_interest_votes()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_widget_interest_votes on public.widget_interest_votes;
create trigger trg_touch_widget_interest_votes
  before update on public.widget_interest_votes
  for each row execute function public.touch_widget_interest_votes();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.widget_interest_votes enable row level security;

-- 유저는 자기 표만 read…
create policy "widget_interest_votes_self_read" on public.widget_interest_votes
  for select using (auth.uid() = user_id);

-- …자기 자신 명의로만 insert…
create policy "widget_interest_votes_self_insert" on public.widget_interest_votes
  for insert with check (auth.uid() = user_id);

-- …그리고 자기 표만 update (재투표 = upsert on conflict 로 want↔skip 덮어쓰기).
create policy "widget_interest_votes_self_update" on public.widget_interest_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Super admin 은 전체 read. qa_feedbacks 와 동일하게 JWT `email` 클레임을 쓴다
-- (authenticated 역할은 auth.users 에 SELECT 권한이 없어 in-policy 서브쿼리가
-- 매칭 대신 실패하므로 `auth.jwt() ->> 'email'` 이 Supabase 지원 경로).
create policy "widget_interest_votes_super_admin_read" on public.widget_interest_votes
  for select using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
