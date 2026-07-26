import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormAnchoredAccess } from '@/lib/scheduling/access';
import { resolveOrCreateProjectForForm } from '@/lib/scheduling/journey-project';
import { maskCandidatesBySource } from '@/lib/scheduling/candidate-masking';

export const maxDuration = 30;

// GET /api/scheduling/journey/schedule?form_id=...
// The 일정(schedule) tab's read path — the full scheduling surface bundle for
// the form's project: groups (batches), candidates (source-masked, same policy
// as the 명단 tab), and slots. Mirrors journey/candidates but adds groups + slots
// so the re-homed calendar + chat + confirmed-roster surface can render from one
// round-trip. Resolve-or-creates the project (opening 일정 = provisioning
// trigger, D5), gate = form-anchored access (owner OR org member OR super-admin).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('form_id') ?? '';
  if (!formId) {
    return NextResponse.json({ error: 'form_id_required' }, { status: 400 });
  }

  const access = await getFormAnchoredAccess(formId);
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const projRes = await resolveOrCreateProjectForForm(admin, {
    formId: access.form.form_id,
    ownerUserId: access.form.user_id,
    title: access.form.title,
    orgId: access.form.org_id,
  });
  if ('error' in projRes) {
    return NextResponse.json({ error: projRes.error }, { status: 500 });
  }
  const projectId = projRes.project.id;

  // Batches (groups) under this project. `is_inbox` is additive → wide/narrow
  // degrade so a preview DB without the column still lists groups.
  type Batch = {
    id: string;
    title: string;
    created_at: string;
    project_id: string | null;
    is_inbox: boolean | null;
  };
  let groups: Batch[] = [];
  const batchWide = await admin
    .from('sched_batches')
    .select('id, title, created_at, project_id, is_inbox')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (batchWide.error) {
    const batchNarrow = await admin
      .from('sched_batches')
      .select('id, title, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(500);
    groups = (batchNarrow.data ?? []).map((b) => ({
      ...(b as Omit<Batch, 'project_id' | 'is_inbox'>),
      project_id: projectId,
      is_inbox: null,
    }));
  } else {
    groups = (batchWide.data ?? []) as Batch[];
  }

  const batchIds = groups.map((b) => b.id);
  if (batchIds.length === 0) {
    return NextResponse.json(
      { project: projRes.project, groups, candidates: [], slots: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Candidates — same source-based contact masking as journey/candidates
  // (bridge rows masked for non-super-admins; upload/sheet/legacy plaintext).
  type Candidate = {
    id: string;
    batch_id: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    fields: Record<string, string> | null;
    status: string;
    source: string | null;
  };
  let candidates: Candidate[] = [];
  const candWide = await admin
    .from('sched_candidates')
    .select('id, batch_id, email, name, phone, fields, status, source')
    .in('batch_id', batchIds)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (candWide.error) {
    const candNarrow = await admin
      .from('sched_candidates')
      .select('id, batch_id, email, name, phone, fields, status')
      .in('batch_id', batchIds)
      .order('created_at', { ascending: true })
      .limit(5000);
    candidates = (candNarrow.data ?? []).map((r) => ({
      ...(r as Omit<Candidate, 'source'>),
      source: null,
    }));
  } else {
    candidates = (candWide.data ?? []) as Candidate[];
  }
  const maskedCandidates = maskCandidatesBySource(candidates, access.superadmin);

  // Slots under this project. Non-cancelled and cancelled alike — the calendar
  // renders cancelled blocks (no strikethrough, comp 승).
  //   Primary anchor  = batch membership (`.in('batch_id', batchIds)`).
  //   Safety net (#572) = slots anchored ONLY by candidate_id (batch_id NULL rows
  //     that slipped batch anchoring) as long as the candidate belongs to THIS
  //     project. Project-scoped via the project's candidate ids — never owner-wide,
  //     which would leak a user's other-project slots into this calendar (spec §2
  //     cross-contamination guard).
  const slotCols =
    'id, candidate_id, batch_id, title, start_at, end_at, status, location, note';
  type SlotRow = { id: string; start_at: string } & Record<string, unknown>;
  const batchSlots = await admin
    .from('sched_slots')
    .select(slotCols)
    .in('batch_id', batchIds)
    .order('start_at', { ascending: true })
    .limit(5000);
  const candidateIds = candidates.map((c) => c.id);
  let candidateSlots: SlotRow[] = [];
  if (candidateIds.length > 0) {
    const res = await admin
      .from('sched_slots')
      .select(slotCols)
      .in('candidate_id', candidateIds)
      .order('start_at', { ascending: true })
      .limit(5000);
    candidateSlots = (res.data ?? []) as SlotRow[];
  }
  // Merge unique by id (a candidate-anchored slot that also has a batch appears in
  // both queries), then keep the start-time order for the calendar.
  const seen = new Set<string>();
  const slotRows: SlotRow[] = [];
  for (const s of [
    ...((batchSlots.data ?? []) as SlotRow[]),
    ...candidateSlots,
  ]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    slotRows.push(s);
  }
  slotRows.sort((a, b) => (a.start_at < b.start_at ? -1 : 1));

  return NextResponse.json(
    {
      project: projRes.project,
      groups,
      candidates: maskedCandidates,
      slots: slotRows,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
