-- Break the RLS-policy recursion between generations and generation_shares.
-- The previous gen_select cross-referenced generation_shares; shares_select
-- cross-referenced generations. Postgres rightfully refuses that. Replace
-- the share-side existence check with a SECURITY DEFINER helper that
-- bypasses RLS on its inner query, and simplify shares_select so it does
-- not reach back into generations.

drop policy if exists "gen_select" on public.generations;
drop policy if exists "shares_select" on public.generation_shares;

create or replace function public.is_generation_shared_with_me(gen_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.generation_shares s
     where s.generation_id = gen_id
       and s.user_id = auth.uid()
  )
$$;

create policy "gen_select" on public.generations
  for select using (
    user_id = auth.uid()
    or (visibility = 'org' and public.has_org_role(org_id, 'viewer'))
    or public.is_generation_shared_with_me(id)
  );

-- Recipients see their own share rows. Owners can already manage shares
-- through the existing shares_manage_by_owner policy, which uses
-- has_org_role/auth.uid() and does not loop.
create policy "shares_select" on public.generation_shares
  for select using (user_id = auth.uid());
