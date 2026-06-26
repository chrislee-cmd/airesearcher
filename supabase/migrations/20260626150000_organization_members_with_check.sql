-- organization_members RLS hardening (PR-SEC19 A).
--
-- The existing insert/update policies authorize via has_org_role(org_id, 'admin')
-- but `update` only declares USING — not WITH CHECK. Without a CHECK clause an
-- admin could mutate the row's `org_id` to a different organization where they
-- have no admin role (USING evaluates the OLD row, CHECK evaluates the NEW one).
-- The insert policy already has WITH CHECK; we restate it idempotently so both
-- write paths express the same admin-of-the-target-org constraint.

drop policy if exists "members_insert_admin" on public.organization_members;
create policy "members_insert_admin" on public.organization_members
  for insert
  with check (public.has_org_role(org_id, 'admin'));

drop policy if exists "members_update_admin" on public.organization_members;
create policy "members_update_admin" on public.organization_members
  for update
  using (public.has_org_role(org_id, 'admin'))
  with check (public.has_org_role(org_id, 'admin'));
