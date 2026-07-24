import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import type { CollabMember } from '@/components/scheduling/collab-share';

// Shared server-side loader for the collaborator-share entry point. Returns
// null unless the caller is an org owner/admin (only they may invite/remove),
// which also gates whether the share button renders at all. Emails are resolved
// in a second .in() step because organization_members and profiles share no
// direct FK — a PostgREST embed would silently return nothing (§7.10).
//
// Extracted so the recruiting-scheduling page and the global topbar share
// button read the same data through one code path (pr-canvas-collab-share-entry).
export async function getCollabShareData(): Promise<{
  orgId: string;
  members: CollabMember[];
} | null> {
  const org = await getActiveOrg();
  if (!org || (org.role !== 'owner' && org.role !== 'admin')) return null;

  const admin = createAdminClient();
  const { data: memberRows } = await admin
    .from('organization_members')
    .select('user_id, invited_email, role')
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: true });
  const rows = (memberRows ?? []) as {
    user_id: string | null;
    invited_email: string | null;
    role: string;
  }[];

  const userIds = rows
    .map((r) => r.user_id)
    .filter((v): v is string => !!v);
  const emailById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', userIds);
    for (const p of (profs ?? []) as { id: string; email: string | null }[]) {
      emailById.set(p.id, p.email ?? '');
    }
  }

  const members: CollabMember[] = rows.map((r) => ({
    userId: r.user_id,
    email: r.user_id ? emailById.get(r.user_id) ?? '' : r.invited_email ?? '',
    role: r.role,
  }));

  return { orgId: org.org_id, members };
}
