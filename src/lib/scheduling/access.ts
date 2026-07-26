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
// Returns the number of rows claimed so callers can log/branch on a 0-match
// (the accept page renders a "invite not found" notice instead of a 404).
export async function claimPendingInvites(
  admin: Admin,
  userId: string,
  email: string | null | undefined,
): Promise<number> {
  if (!email) return 0;
  const { data } = await admin
    .from('organization_members')
    .update({ user_id: userId, invited_email: null })
    .is('user_id', null)
    .ilike('invited_email', email)
    .select('id');
  return data?.length ?? 0;
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

// Form-anchored access for the fused recruiting journey (BUILD-SPEC §5.5). The
// fused surface is keyed on a recruiting form, so its gate is: super-admin OR the
// form's owner OR someone who shares an org with the form owner. This is layered
// ON TOP OF the existing owner_user_id scoping (getSchedulingAccess) — it does not
// replace it, keeping the tested tenancy wall intact (regression 0).
//
// Returns null (→ caller 404s, route unobservable) when there's no session, the
// form doesn't exist, or the caller is neither the owner nor an org co-member.
// `ownerUserIds` mirrors getSchedulingAccess so downstream candidate/batch
// scoping stays uniform.
export type FormAnchoredAccess = {
  superadmin: boolean;
  userId: string;
  ownerUserIds: string[] | null; // null only for super-admin (unrestricted)
  form: { form_id: string; user_id: string; org_id: string | null; title: string };
};

export async function getFormAnchoredAccess(
  formId: string,
): Promise<FormAnchoredAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const admin = createAdminClient();
  // owner_email may exist too, but user_id + org_id + title are all we need.
  const { data: form } = await admin
    .from('recruiting_forms')
    .select('form_id, user_id, org_id, title')
    .eq('form_id', formId)
    .maybeSingle();
  if (!form) return null;
  const f = form as {
    form_id: string;
    user_id: string;
    org_id: string | null;
    title: string | null;
  };
  const anchoredForm = {
    form_id: f.form_id,
    user_id: f.user_id,
    org_id: f.org_id ?? null,
    title: f.title ?? '',
  };

  if (isSuperAdminEmail(user.email)) {
    return { superadmin: true, userId: user.id, ownerUserIds: null, form: anchoredForm };
  }

  // Reuse the tested org-membership computation (also self-heals pending
  // invites). A form owner with no org membership still gets access to their own
  // form's surface, scoped to just themselves.
  const base = await getSchedulingAccess();
  const coMembers =
    base && !base.superadmin ? base.ownerUserIds : [user.id];
  const isFormOwner = f.user_id === user.id;
  if (isFormOwner || coMembers.includes(f.user_id)) {
    const ownerUserIds = coMembers.includes(user.id)
      ? coMembers
      : [...coMembers, user.id];
    return { superadmin: false, userId: user.id, ownerUserIds, form: anchoredForm };
  }
  return null;
}

// Project-anchored access for the form-free intake path (card 583). The fused
// recruiting journey can also be opened for a recruiting PILL project
// (interview_projects) that has no Google form yet, so a user who already has a
// participant list can intake it. Gate = super-admin OR the interview project's
// owner OR someone who shares an org with that owner — the exact twin of
// getFormAnchoredAccess but keyed on interview_projects instead of recruiting_forms.
//
// Returns null (→ caller 404s, route unobservable) when there's no session, the
// interview project doesn't exist, or the caller is outside its org scope. The
// returned `project` carries the owner / org / title used to provision (and
// converge on) the interview_project-anchored sched_projects row.
export type ProjectAnchoredAccess = {
  superadmin: boolean;
  userId: string;
  ownerUserIds: string[] | null; // null only for super-admin (unrestricted)
  project: {
    interview_project_id: string;
    user_id: string;
    org_id: string | null;
    title: string;
  };
};

export async function getProjectAnchoredAccess(
  interviewProjectId: string,
): Promise<ProjectAnchoredAccess | null> {
  const base = await getSchedulingAccess();
  if (!base) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from('interview_projects')
    .select('id, user_id, org_id, name')
    .eq('id', interviewProjectId)
    .maybeSingle();
  if (!data) return null;
  const p = data as {
    id: string;
    user_id: string;
    org_id: string | null;
    name: string | null;
  };
  const project = {
    interview_project_id: p.id,
    user_id: p.user_id,
    org_id: p.org_id ?? null,
    title: p.name ?? '',
  };

  if (base.superadmin) {
    return { superadmin: true, userId: base.userId, ownerUserIds: null, project };
  }
  // Org-scoped: the pill project's owner must be within the caller's org scope,
  // else the route stays unobservable (no cross-tenant provisioning).
  if (!base.ownerUserIds.includes(p.user_id)) return null;
  return {
    superadmin: false,
    userId: base.userId,
    ownerUserIds: base.ownerUserIds,
    project,
  };
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
