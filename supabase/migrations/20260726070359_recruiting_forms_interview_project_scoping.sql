-- 리크루팅 응답 데이터를 pill 프로젝트(interview_projects) 축으로 스코핑.
--
-- 배경 (card #575, #1212 워커 핸드오프): pill 에서 새 프로젝트를 만들어도
-- Responses 탭에 이전 프로젝트의 설문/응답이 그대로 보였다. 원인 = 리크루팅
-- 데이터가 프로젝트로 묶여 있지 않고 user_id 단위로만 조회됨.
--
-- 사용자 결정(2026-07-26, a안): 리크루팅을 **pill 축(interview_projects)** 으로
-- 스코핑한다. 주의 — recruiting_forms.project_id(마이그 0014)는 **옛 projects
-- 테이블**을 참조하는 다른 축이라 pill 과 무관하다. 이 컬럼은 건드리지 않고
-- 신규 interview_project_id 컬럼으로 pill 귀속을 표현한다.
--
-- additive·idempotent (재실행 안전). 롤백 시 컬럼만 남고 기능 회귀 없음.

------------------------------------------------------------------------
-- 1) interview_project_id 컬럼 신설 (pill 축)
------------------------------------------------------------------------

alter table public.recruiting_forms
  add column if not exists interview_project_id uuid
    references public.interview_projects(id) on delete set null;

-- forms/list 의 (user_id, interview_project_id) 스코프 조회용.
create index if not exists recruiting_forms_user_interview_project_idx
  on public.recruiting_forms (user_id, interview_project_id);

-- 축 혼동 방지: 옛 project_id 는 pill 축이 아님을 컬럼 주석으로 못박는다.
comment on column public.recruiting_forms.project_id is
  'DEPRECATED (2026-07-26): legacy public.projects 축 참조 — pill 축 아님. '
  'pill 귀속은 interview_project_id (references interview_projects) 를 쓴다.';
comment on column public.recruiting_forms.interview_project_id is
  'Pill 축 프로젝트 귀속 — references interview_projects(id). '
  'forms/create 가 stamp, forms/list 가 이 컬럼으로 필터한다.';

------------------------------------------------------------------------
-- 2) 백필 — interview_project_id IS NULL 폼을 소유자별로 한 프로젝트에 귀속
--
-- 정책 (데이터 유실/미아 0):
--   - 소유자에게 활성 interview_project 가 있으면 가장 오래된 것에 귀속.
--   - 활성이 하나도 없으면 보관 포함 가장 오래된 것에 귀속.
--   - 프로젝트가 전무하면 소유자용으로 1개 시드해서 귀속(org_id 는 소유자의
--     기존 recruiting_forms.org_id → 없으면 조직 멤버십에서 해석).
--   - 조직 컨텍스트조차 없으면(극히 드묾) NULL 유지 — 오늘과 동일하게
--     user 스코프로 조회돼 회귀 0(미아 아님).
--
-- 백필 후 대다수 폼은 NULL 잔존 0. 신규 발행분은 forms/create 가 항상 stamp.
------------------------------------------------------------------------

do $$
declare
  r record;
  target_project uuid;
  seed_org uuid;
begin
  for r in
    select distinct user_id
    from public.recruiting_forms
    where interview_project_id is null
  loop
    target_project := null;
    seed_org := null;

    -- 소유자의 가장 오래된 활성 프로젝트.
    select id into target_project
    from public.interview_projects
    where user_id = r.user_id and archived_at is null
    order by created_at asc
    limit 1;

    -- 활성이 없으면 보관 포함 가장 오래된 프로젝트(미아 방지 — 복원 시 복귀).
    if target_project is null then
      select id into target_project
      from public.interview_projects
      where user_id = r.user_id
      order by created_at asc
      limit 1;
    end if;

    -- 프로젝트가 전무하면 시드. org_id 는 not null 이라 반드시 해석해야 한다.
    if target_project is null then
      select org_id into seed_org
      from public.recruiting_forms
      where user_id = r.user_id and org_id is not null
      limit 1;

      if seed_org is null then
        select org_id into seed_org
        from public.organization_members
        where user_id = r.user_id
        order by created_at asc
        limit 1;
      end if;

      -- 조직 컨텍스트 없음 — 프로젝트 생성 불가. NULL 유지(오늘과 동일 동작).
      if seed_org is null then
        continue;
      end if;

      insert into public.interview_projects (org_id, user_id, name)
      values (seed_org, r.user_id, '리크루팅 기존 설문')
      returning id into target_project;
    end if;

    update public.recruiting_forms
    set interview_project_id = target_project
    where user_id = r.user_id and interview_project_id is null;
  end loop;
end $$;
