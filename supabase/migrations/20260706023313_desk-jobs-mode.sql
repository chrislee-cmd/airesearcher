-- 데스크 v2: 목적 기반 3 mode (trend / market / custom).
-- default 'custom' — 이 컬럼 도입 전의 모든 job 은 소스 직접 선택(옛 flow)
-- 이었으므로, 기존 row 가 자동으로 custom 으로 분류돼 회귀가 없다.
alter table public.desk_jobs
  add column if not exists mode text not null default 'custom'
  check (mode in ('trend', 'market', 'custom'));

comment on column public.desk_jobs.mode is
  '리서치 목적 mode: trend(트렌드) | market(시장조사) | custom(소스 직접 선택, legacy default)';
