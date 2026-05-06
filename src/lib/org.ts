import { createClient } from '@/lib/supabase/server';

export type OrgMembership = {
  org_id: string;
  org_name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};

export async function getCurrentUserOrgs(): Promise<OrgMembership[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organization_members')
    .select('role, organization:organizations(id, name)')
    .order('created_at', { ascending: true });
  return (data ?? []).map((row) => {
    const o = row.organization as unknown as { id: string; name: string } | null;
    return {
      org_id: o?.id ?? '',
      org_name: o?.name ?? '',
      role: row.role as OrgMembership['role'],
    };
  });
}

export async function getActiveOrg(): Promise<OrgMembership | null> {
  const orgs = await getCurrentUserOrgs();
  return orgs[0] ?? null;
}

// Lightweight flags read for gating preview features and other admin-only
// surfaces. Returns false-y defaults when the row is missing so callers
// don't need to null-check.
export async function getOrgFlags(orgId: string): Promise<{
  isUnlimited: boolean;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('is_unlimited')
    .eq('id', orgId)
    .single();
  return { isUnlimited: Boolean(data?.is_unlimited) };
}
