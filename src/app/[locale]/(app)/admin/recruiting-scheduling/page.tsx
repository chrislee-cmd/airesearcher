import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSchedulingAccess } from '@/lib/scheduling/access';
import { getActiveOrg } from '@/lib/org';
import type { CollabMember } from '@/components/scheduling/collab-share';
import {
  RecruitingSchedulingClient,
  type SchedProject,
  type SchedBatch,
  type SchedCandidate,
} from '@/components/admin/recruiting-scheduling-client';
import type { SchedSlot } from '@/lib/scheduling/slots';

// Super-admin-only shell for the recruiting-scheduling stack (PR-C reorg). Same
// gate as /admin/recruiting-invitations — getCurrentUser + isSuperAdminEmail +
// notFound() keeps the route unobservable to other accounts. Reads go through
// the service-role client (RLS super-admin policy also backstops).
//
// PR-C introduces a `project` layer above batches (=groups). The loader selects
// a project, then loads every group (batch) under it plus all their candidates
// and slots, so the client can render an "all list" or a "grouped" view. A
// preview DB that hasn't had the additive `sched_projects` / `project_id`
// migration applied yet (auto-apply runs on merge to main only) has no projects
// table — the loader then degrades to the legacy batch-only view, treating each
// batch as its own project so the page never blanks or 500s.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ project?: string; batch?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Gate opened from super-admin-only to super-admin OR org member. Org members
  // are tenancy-scoped to data owned by someone who shares an org with them
  // (sched_* tables have owner_user_id, not org_id — code-level scoping is the
  // hard precondition for opening the gate). getSchedulingAccess also claims any
  // pending invite for this email on first visit.
  const access = await getSchedulingAccess();
  if (!access) notFound();
  const ownerIds = access.superadmin ? null : access.ownerUserIds;

  // Touch the RLS-scoped client so an auth refresh happens in the normal path;
  // the actual reads use the service-role admin client (mirrors invitations).
  await createClient();
  const admin = createAdminClient();

  const { project: projectParam, batch: batchParam } = await searchParams;

  // --- Projects (top layer) ---------------------------------------------
  // share_token feeds the redesign's project-shared master link (BUILD-SPEC
  // §5.1). It's additive (migration auto-applies on merge to main only), so a
  // preview DB may lack the column — the wide select then errors and we fall
  // back to the pre-share_token column set (master-link bar simply hides).
  let projectsWide = admin
    .from('sched_projects')
    .select('id, title, created_at, share_token');
  if (ownerIds) projectsWide = projectsWide.in('owner_user_id', ownerIds);
  const projectsRes = await projectsWide
    .order('created_at', { ascending: false })
    .limit(200);

  let projectsNarrowQ = admin
    .from('sched_projects')
    .select('id, title, created_at');
  if (ownerIds) projectsNarrowQ = projectsNarrowQ.in('owner_user_id', ownerIds);
  const projectsNarrow = projectsRes.error
    ? await projectsNarrowQ
        .order('created_at', { ascending: false })
        .limit(200)
    : null;

  // Legacy/degrade mode: no sched_projects table on this DB (preview). Present
  // each batch as its own project so the picker + grouped view still render.
  const degraded = !!projectsRes.error && !!projectsNarrow?.error;

  let projects: SchedProject[] = [];
  let groups: SchedBatch[] = [];
  let selectedProjectId: string | null = null;

  if (!degraded) {
    projects = (projectsRes.error
      ? (projectsNarrow?.data ?? [])
      : (projectsRes.data ?? [])) as SchedProject[];
    selectedProjectId =
      projectParam && projects.some((p) => p.id === projectParam)
        ? projectParam
        : (projects[0]?.id ?? null);

    if (selectedProjectId) {
      // is_inbox distinguishes the upload pool from user-made groups; it's
      // additive so a preview DB may lack it — wide/narrow fallback defaults it
      // to false (every batch then reads as a group).
      const wideGroups = await admin
        .from('sched_batches')
        .select('id, title, created_at, project_id, is_inbox')
        .eq('project_id', selectedProjectId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (wideGroups.error) {
        const { data: groupRows } = await admin
          .from('sched_batches')
          .select('id, title, created_at, project_id')
          .eq('project_id', selectedProjectId)
          .order('created_at', { ascending: false })
          .limit(500);
        groups = (groupRows ?? []).map((g) => ({
          ...g,
          is_inbox: false,
        })) as SchedBatch[];
      } else {
        groups = (wideGroups.data ?? []) as SchedBatch[];
      }
    }
  } else {
    // Batch-only fallback: every batch is a standalone project with itself as
    // its single group.
    let batchQ = admin
      .from('sched_batches')
      .select('id, title, created_at');
    if (ownerIds) batchQ = batchQ.in('owner_user_id', ownerIds);
    const { data: batchRows } = await batchQ
      .order('created_at', { ascending: false })
      .limit(200);
    const batches = (batchRows ?? []) as SchedBatch[];
    projects = batches.map((b) => ({
      id: b.id,
      title: b.title,
      created_at: b.created_at,
    }));
    // `?project=` and legacy `?batch=` both select a batch here.
    const wanted = projectParam || batchParam || null;
    selectedProjectId =
      wanted && batches.some((b) => b.id === wanted)
        ? wanted
        : (batches[0]?.id ?? null);
    groups = selectedProjectId
      ? batches.filter((b) => b.id === selectedProjectId)
      : [];
  }

  const groupIds = groups.map((g) => g.id);

  // --- Candidates across all groups of the selected project -------------
  let candidates: SchedCandidate[] = [];
  let slots: SchedSlot[] = [];
  if (groupIds.length > 0) {
    // `status` (PR-A bulk-confirm flag) may be missing on a preview whose DB
    // hasn't had the additive migration applied — a wide select then errors, so
    // fall back to the pre-status column set and default status to 'pending'
    // (same wide/narrow pattern the rest of this loader uses). batch_id is
    // surfaced so the client can render the grouped view (PR-C).
    const wide = await admin
      .from('sched_candidates')
      .select('id, batch_id, email, name, phone, fields, participant_token, status')
      .in('batch_id', groupIds)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (wide.error) {
      const narrow = await admin
        .from('sched_candidates')
        .select('id, batch_id, email, name, phone, fields, participant_token')
        .in('batch_id', groupIds)
        .order('created_at', { ascending: true })
        .limit(5000);
      candidates = (narrow.data ?? []).map((r) => ({
        ...r,
        status: 'pending',
      })) as SchedCandidate[];
    } else {
      candidates = (wide.data ?? []) as SchedCandidate[];
    }

    // Slots for these groups. Preferred path = batch_id scope (PR-B) so
    // candidate-less titled events are included. The title/batch_id columns are
    // additive and only auto-apply on merge to main, so a preview DB may not
    // have them yet — the wide select then errors and we fall back to the
    // pre-PR-B candidate-scoped fetch (sched_slots/sched_batches have no embed
    // FK — PROJECT.md §7.10).
    const wideSlots = await admin
      .from('sched_slots')
      .select(
        'id, candidate_id, batch_id, title, start_at, end_at, status, location, note',
      )
      .in('batch_id', groupIds)
      .order('start_at', { ascending: true })
      .limit(10000);
    if (wideSlots.error) {
      const candidateIds = candidates.map((c) => c.id);
      if (candidateIds.length > 0) {
        const { data: slotRows } = await admin
          .from('sched_slots')
          .select('id, candidate_id, start_at, end_at, status, location, note')
          .in('candidate_id', candidateIds)
          .order('start_at', { ascending: true })
          .limit(10000);
        slots = (slotRows ?? []).map((r) => ({
          ...r,
          batch_id: null,
          title: null,
        })) as SchedSlot[];
      }
    } else {
      slots = (wideSlots.data ?? []) as SchedSlot[];
    }
  }

  // Collaborator share — shown only to an org owner/admin (they may invite +
  // remove). The invite reuses POST /api/members/invite (role=member, full
  // access) which now also sends the real invite email.
  let collab: { orgId: string; members: CollabMember[] } | null = null;
  const org = await getActiveOrg();
  if (org && (org.role === 'owner' || org.role === 'admin')) {
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
    // Resolve emails in a second step — organization_members and profiles share
    // no direct FK, so a PostgREST embed would silently return nothing (§7.10).
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
      email: r.user_id
        ? emailById.get(r.user_id) ?? ''
        : r.invited_email ?? '',
      role: r.role,
    }));
    collab = { orgId: org.org_id, members };
  }

  return (
    <RecruitingSchedulingClient
      projects={projects}
      selectedProjectId={selectedProjectId}
      groups={groups}
      candidates={candidates}
      slots={slots}
      collab={collab}
    />
  );
}
