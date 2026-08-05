import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

// Selected-active-org cookie. Holds an org_id the user explicitly switched to
// (profile-menu switcher / invite-accept). ALWAYS re-validated against the
// caller's live memberships before it's trusted — a raw cookie is never enough
// to grant access (org takeover guard, spec §제약 2). Read-only surfaces read
// it via getActiveOrg; the writer is POST/GET /api/account/active-org.
export const ACTIVE_ORG_COOKIE = 'active_org';

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
    // Scope to the caller's OWN membership rows. RLS members_select =
    // has_org_role(org_id,'viewer') would otherwise leak EVERY member row of
    // any org the caller belongs to (incl. pending user_id-null invites),
    // duplicating the switcher and letting a stranger's row poison the
    // no-cookie active-org fallback (spec §진단). No user = not signed in →
    // empty list, unchanged behaviour.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from('organization_members')
      .select('role, organization:organizations(id, name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    const seen = new Set<string>();
    const orgs: OrgMembership[] = [];
    for (const row of data ?? []) {
      const o = row.organization as unknown as { id: string; name: string } | null;
      const orgId = o?.id ?? '';
      // Defensive dedupe by org_id — keep first (oldest, order preserved) row
      // in case of stray duplicate memberships.
      if (seen.has(orgId)) continue;
      seen.add(orgId);
      orgs.push({
        org_id: orgId,
        org_name: o?.name ?? '',
        role: row.role as OrgMembership['role'],
      });
    }
    return orgs;
  },
);

// Resolve which org the caller is currently "in". Precedence:
//   1. active_org cookie — IFF it names an org the caller is actually a member
//      of (membership re-checked every request against getCurrentUserOrgs).
//   2. fallback: first membership (oldest = the org handle_new_user auto-created
//      at signup). This is the pre-switcher behaviour, so any user WITHOUT the
//      cookie keeps 100% identical resolution (spec §제약 1).
// A cookie that points at a org the user left / never joined / a forged uuid is
// silently ignored → fallback. The return shape is unchanged so all ~70 API
// callers stay compatible (spec §제약 3).
export const getActiveOrg = cache(
  async (): Promise<OrgMembership | null> => {
    const orgs = await getCurrentUserOrgs();
    if (orgs.length === 0) return null;

    const selected = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    if (selected) {
      const match = orgs.find((o) => o.org_id === selected);
      if (match) return match;
      // stale/forged cookie — not a current membership. Ignore, fall through.
    }
    return orgs[0];
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
