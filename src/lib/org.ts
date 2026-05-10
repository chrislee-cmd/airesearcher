import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export type OrgMembership = {
  org_id: string;
  org_name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};

// React cache() dedupes within a single SSR request — layout + page +
// API route handlers all hit the same in-memory result instead of
// re-querying Supabase.
export const getCurrentUserOrgs = cache(
  async (): Promise<OrgMembership[]> => {
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
  },
);

export const getActiveOrg = cache(
  async (): Promise<OrgMembership | null> => {
    const orgs = await getCurrentUserOrgs();
    return orgs[0] ?? null;
  },
);

// Lightweight flags read for gating preview features and other admin-only
// surfaces. Returns false-y defaults when the row is missing so callers
// don't need to null-check.
export const getOrgFlags = cache(
  async (orgId: string): Promise<{ isUnlimited: boolean }> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('organizations')
      .select('is_unlimited')
      .eq('id', orgId)
      .single();
    return { isUnlimited: Boolean(data?.is_unlimited) };
  },
);
