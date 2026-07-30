-- shared_views 에 recruiting_summary(6번째 타입) 편입 — 리크루팅 읽기전용 공유.
--
-- 배경: 리크루팅엔 읽기전용 공유 링크가 없었다(공유 수단 = org 멤버 초대뿐,
-- full 권한). 산출물 통합 에픽이 polymorphic shared_views(토큰·만료·revoke·
-- 이메일 게이트) + feature-blind 공유 셸(/share/d)을 이미 깔아뒀으므로, 여기에
-- recruiting_summary 타입 하나만 추가해 "결과만 보여주는 링크"를 완성한다.
-- 공개 노출은 집계·요약만(조건 chips · 성별×연령 크로스탭 · 부합도 카운트) —
-- 개별 응답자 행·연락처·자유응답 원문은 로더가 일절 반환하지 않는다.
--
-- ⚠️ resource_id uuid → text 타입 변경 (자동적용 대상 아님):
--   resource_type 별 resource_id 가 가리키는 PK 가 지금까지 전부 uuid 였는데,
--   recruiting 의 PK 는 recruiting_forms.form_id = Google Forms id(text, uuid
--   아님)다. polymorphic resource_id 를 유지하려면 text 로 넓혀야 한다. uuid→
--   text 캐스팅은 무손실(모든 기존 uuid 값이 그대로 문자열화)이고 5개 기존
--   타입의 .eq('id', resource_id) 조회도 postgres implicit cast 로 불변.
--
--   단 이 ALTER COLUMN ... TYPE 는 apply-migrations 워크플로의 DESTRUCTIVE_RE
--   (type change)에 걸려 **자동 적용되지 않는다** — 이 파일 전체가 스킵되고
--   job 이 red 로 표시된다(PROJECT.md §7.5). 머지 담당자가 prod SQL editor
--   또는 supabase db push 로 **수동 적용**해야 기능이 활성화된다. 미적용 상태
--   에서는 CHECK 도 미확장 + resource_id 도 uuid 라 recruiting 공유 발급이
--   조용히 실패(insert reject → 403)할 뿐, 기존 5타입은 전혀 영향 없다(안전한
--   무활성 상태 — 부분 손상 없음). 재실행 idempotent.

-- 1) resource_id 를 polymorphic text 로 (uuid PK + Google Forms text id 공존).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_views'
      and column_name = 'resource_id'
      and data_type = 'uuid'
  ) then
    alter table public.shared_views
      alter column resource_id type text using resource_id::text;
  end if;
end $$;

-- 2) CHECK 를 6타입으로 확장 — recruiting_summary 추가(넓히기만, 기존 행 무영향).
alter table public.shared_views
  drop constraint if exists shared_views_resource_type_check;

alter table public.shared_views
  add constraint shared_views_resource_type_check
  check (
    resource_type in (
      'interview_topline',
      'probing_persona',
      'transcript',
      'ut_insight',
      'desk_report',
      'recruiting_summary'
    )
  );
