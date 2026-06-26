-- probing_questions — 개별 질문 단위 영속화 (PR-12).
--
-- PR-8 의 `probing_suggestions` 는 한 suggest stream 결과 (3~10 질문 묶음)
-- 를 1 row + `suggestion_set` jsonb 로 보관했다. 사용자 요청으로 batch 단위
-- 표시를 폐기하고 모든 질문을 개별 단위로 다루기 위해 신규 테이블을
-- 도입한다. 기존 테이블은 deprecate 까지 보존 (후속 PR).
--
-- 한 row = 한 질문. delete / 핵심 표시 / 검색 같은 후속 조작이 자연스럽다.

create table if not exists public.probing_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 질문 본문 / 분류.
  text text not null,
  technique text not null,
  -- 모델이 생성한 사용 이유. 현재 클라이언트는 빈 문자열을 보내지만 컬럼은
  -- 미래 (intents UX 복귀 등) 를 위해 유지.
  why text,
  -- PR-9 의 가이드 정합 메타. 가이드가 비어 있을 땐 null.
  guide_reference text,
  -- 출처 디버깅 / 추적.
  transcript_cutoff text,
  -- 마이그레이션 출처: 기존 probing_suggestions row 의 id (있다면). 새 stream
  -- 으로 들어온 행은 null. data migration idempotency 의 unique key 이기도 함.
  source_set_id uuid,
  created_at timestamptz not null default now()
);

-- 본인 user 의 최신 N개 — 유일한 read pattern. RLS 가 user_id 로 gate 하므로
-- user_id 를 첫 컬럼으로.
create index if not exists probing_questions_user_created_idx
  on public.probing_questions (user_id, created_at desc);

alter table public.probing_questions enable row level security;

-- 본인만 select / insert / delete. probing_suggestions 의 RLS 패턴과 동일.
-- insert 는 org membership 검사를 추가해서 forged payload 도 차단.
drop policy if exists "probing_questions_own_select" on public.probing_questions;
create policy "probing_questions_own_select" on public.probing_questions
  for select using (user_id = auth.uid());

drop policy if exists "probing_questions_own_insert" on public.probing_questions;
create policy "probing_questions_own_insert" on public.probing_questions
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

drop policy if exists "probing_questions_own_delete" on public.probing_questions;
create policy "probing_questions_own_delete" on public.probing_questions
  for delete using (user_id = auth.uid());

-- 데이터 마이그레이션 — 기존 probing_suggestions 의 jsonb questions 를
-- 개별 row 로 flatten. idempotent: source_set_id 가 이미 들어간 set 은 skip.
-- 같은 set 안의 질문 순서는 created_at + idx ms offset 으로 보존 (정렬 시).
insert into public.probing_questions (
  org_id,
  user_id,
  text,
  technique,
  why,
  guide_reference,
  transcript_cutoff,
  source_set_id,
  created_at
)
select
  ps.org_id,
  ps.user_id,
  coalesce(q->>'text', ''),
  coalesce(q->>'technique', 'tell_more'),
  q->>'why',
  q->>'guide_reference',
  ps.transcript_cutoff,
  ps.id,
  ps.created_at + ((ord - 1) * interval '1 millisecond')
from public.probing_suggestions ps
cross join lateral jsonb_array_elements(ps.suggestion_set->'questions')
  with ordinality as t(q, ord)
where coalesce(q->>'text', '') <> ''
  and not exists (
    select 1 from public.probing_questions pq
    where pq.source_set_id = ps.id
  );
