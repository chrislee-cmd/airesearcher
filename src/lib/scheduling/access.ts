// Shared access + tenancy scoping for the recruiting-scheduling stack.
//
// Background: the scheduling gate used to be super-admin-only. This PR opens it
// to org members (full access — no viewer tier yet). But sched_* tables carry
// only `owner_user_id`, no `org_id`, so opening service-role reads to any org
// member would expose *every* owner's data across tenants. We scope in code:
// an org member may only touch scheduling data whose `owner_user_id` shares an
// org with them. Super-admins stay unrestricted (legacy behaviour).
//
// Ownership chain: sched_projects/sched_batches carry owner_user_id directly;
// sched_candidates → batch, sched_slots → batch|candidate, sched_messages →
// batch|candidate. The owner resolvers below walk that chain.
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

type Admin = ReturnType<typeof createAdminClient>;

export type SchedulingAccess =
  | { superadmin: true; userId: string; ownerUserIds: null }
  | { superadmin: false; userId: string; ownerUserIds: string[] };

// Claim any pending org invites addressed to this user's email — links the
// organization_members row (invited_email set, user_id null) to the now-known
// user_id so a freshly-signed-up invitee becomes a full org member. Idempotent
// (a 0-row update once already claimed). Service-role client bypasses RLS.
export async function claimPendingInvites(
  admin: Admin,
  userId: string,
  email: string | null | undefined,
): Promise<void> {
  if (!email) return;
  await admin
    .from('organization_members')
    .update({ user_id: userId, invited_email: null })
    .is('user_id', null)
    .ilike('invited_email', email);
}

// Resolve the caller's scheduling access. super-admin = unrestricted. Org
// member = scoped to the set of owner_user_ids that share an org with them
// (includes themselves). No session / no org membership = null → the caller
// returns 404 (route stays unobservable, mirroring the old super-admin gate).
export async function getSchedulingAccess(): Promise<SchedulingAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (isSuperAdminEmail(user.email)) {
    return { superadmin: true, userId: user.id, ownerUserIds: null };
  }

  const admin = createAdminClient();
  // Self-heal: claim any invite waiting on this email before reading membership
  // so an invitee who just signed up is recognised on their first visit.
  await claimPendingInvites(admin, user.id, user.email);

  const { data: myOrgs } = await admin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id);
  const orgIds = [
    ...new Set((myOrgs ?? []).map((r) => r.org_id as string).filter(Boolean)),
  ];
  if (orgIds.length === 0) return null;

  const { data: coMembers } = await admin
    .from('organization_members')
    .select('user_id')
    .in('org_id', orgIds);
  const ownerUserIds = [
    ...new Set(
      (coMembers ?? [])
        .map((r) => r.user_id as string | null)
        .filter((v): v is string => !!v),
    ),
  ];
  if (!ownerUserIds.includes(user.id)) ownerUserIds.push(user.id);

  return { superadmin: false, userId: user.id, ownerUserIds };
}

// True when the caller may touch a resource owned by ownerUserId.
export function ownerAllowed(
  access: SchedulingAccess,
  ownerUserId: string | null | undefined,
): boolean {
  if (access.superadmin) return true;
  if (!ownerUserId) return false;
  return access.ownerUserIds.includes(ownerUserId);
}

// --- Owner resolvers (service-role) — walk the sched_* ownership chain. ------

export async function ownerOfProject(
  admin: Admin,
  id: string,
): Promise<string | null> {
  const { data } = await admin
    .from('sched_projects')
    .select('owner_user_id')
    .eq('id', id)
    .maybeSingle();
  return (data?.owner_user_id as string | undefined) ?? null;
}

export async function ownerOfBatch(
  admin: Admin,
  id: string,
): Promise<string | null> {
  const { data } = await admin
    .from('sched_batches')
    .select('owner_user_id')
    .eq('id', id)
    .maybeSingle();
  return (data?.owner_user_id as string | undefined) ?? null;
}

export async function ownerOfCandidate(
  admin: Admin,
  id: string,
): Promise<string | null> {
  const { data } = await admin
    .from('sched_candidates')
    .select('batch_id')
    .eq('id', id)
    .maybeSingle();
  const batchId = data?.batch_id as string | undefined;
  return batchId ? ownerOfBatch(admin, batchId) : null;
}

export async function ownerOfSlot(
  admin: Admin,
  id: string,
): Promise<string | null> {
  const { data } = await admin
    .from('sched_slots')
    .select('batch_id, candidate_id')
    .eq('id', id)
    .maybeSingle();
  const batchId = data?.batch_id as string | undefined;
  if (batchId) return ownerOfBatch(admin, batchId);
  const candId = data?.candidate_id as string | undefined;
  return candId ? ownerOfCandidate(admin, candId) : null;
}

// Given candidate ids, return the subset the caller may touch (super-admin =
// all). Resolves each candidate's batch owner. Used by the bulk candidate
// mutation routes to drop foreign ids rather than 404 the whole request.
export async function accessibleCandidateIds(
  admin: Admin,
  access: SchedulingAccess,
  ids: string[],
): Promise<string[]> {
  if (access.superadmin) return ids;
  if (ids.length === 0) return [];
  const { data: cands } = await admin
    .from('sched_candidates')
    .select('id, batch_id')
    .in('id', ids);
  const rows = (cands ?? []) as { id: string; batch_id: string | null }[];
  const batchIds = [
    ...new Set(rows.map((c) => c.batch_id).filter((v): v is string => !!v)),
  ];
  if (batchIds.length === 0) return [];
  const { data: batches } = await admin
    .from('sched_batches')
    .select('id, owner_user_id')
    .in('id', batchIds);
  const allowedBatch = new Set(
    ((batches ?? []) as { id: string; owner_user_id: string }[])
      .filter((b) => access.ownerUserIds.includes(b.owner_user_id))
      .map((b) => b.id),
  );
  return rows
    .filter((c) => c.batch_id && allowedBatch.has(c.batch_id))
    .map((c) => c.id);
}

export async function ownerOfMessage(
  admin: Admin,
  id: string,
): Promise<string | null> {
  const { data } = await admin
    .from('sched_messages')
    .select('batch_id, candidate_id')
    .eq('id', id)
    .maybeSingle();
  const batchId = data?.batch_id as string | undefined;
  if (batchId) return ownerOfBatch(admin, batchId);
  const candId = data?.candidate_id as string | undefined;
  return candId ? ownerOfCandidate(admin, candId) : null;
}
