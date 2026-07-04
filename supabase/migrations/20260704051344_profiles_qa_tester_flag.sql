-- QA mode flag: mark a profile as a QA tester (external user issued a QA account).
-- Consumed by the auth context (isQaTester) to conditionally render QA-only UI
-- (e.g. the voice feedback mic button). Registration stays super-admin manual for now:
--   update public.profiles set is_qa_tester = true where id = '<user-uuid>';
alter table public.profiles
  add column if not exists is_qa_tester boolean not null default false;
