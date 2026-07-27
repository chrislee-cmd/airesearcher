import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getFormAnchoredAccess,
  getProjectAnchoredAccess,
} from '@/lib/scheduling/access';
import {
  resolveOrCreateProjectForForm,
  resolveInboxBatch,
} from '@/lib/scheduling/journey-project';
import { maskCandidatesBySource } from '@/lib/scheduling/candidate-masking';

export const maxDuration = 30;

// GET /api/scheduling/journey/candidates?form_id=...[&project_id=...]
// The intake band's candidate read path. Resolve-or-creates the journey's project
// (진입 = provisioning trigger, D5) then returns its candidates with SOURCE-BASED
// CONTACT MASKING enforced server-side: 'bridge' rows have their phone/email
// replaced with ●●●● for non-super-admins; upload/sheet/legacy rows stay plaintext
// (the user's own data).
//
// TWO ANCHORS (card 583, form-free intake): form_id → form-anchored access; else
// project_id (an interview_projects/pill id) → project-anchored access. When BOTH
// are present the form path also stamps interview_project_id so the two axes
// converge on ONE sched_projects row (roster never splits). At least one required.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('form_id') ?? '';
  const projectIdParam = searchParams.get('project_id') ?? '';

  let superadmin: boolean;
  let provision: {
    formId: string | null;
    interviewProjectId: string | null;
    ownerUserId: string;
    title: string;
    orgId: string | null;
  };
  if (formId) {
    const access = await getFormAnchoredAccess(formId);
    if (!access) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    superadmin = access.superadmin;
    provision = {
      formId: access.form.form_id,
      // stamp the pill axis onto the form's project when the client knows it.
      interviewProjectId: projectIdParam || null,
      ownerUserId: access.form.user_id,
      title: access.form.title,
      orgId: access.form.org_id,
    };
  } else if (projectIdParam) {
    const access = await getProjectAnchoredAccess(projectIdParam);
    if (!access) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    superadmin = access.superadmin;
    provision = {
      formId: null,
      interviewProjectId: access.project.interview_project_id,
      ownerUserId: access.project.user_id,
      title: access.project.title,
      orgId: access.project.org_id,
    };
  } else {
    return NextResponse.json(
      { error: 'form_id_or_project_id_required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const projRes = await resolveOrCreateProjectForForm(admin, provision);
  if ('error' in projRes) {
    return NextResponse.json({ error: projRes.error }, { status: 500 });
  }
  const projectId = projRes.project.id;

  // Linked-sheet card (R9): project's remembered Google Sheet (title/synced_at).
  // Additive columns → wide/narrow degrade (a preview DB without them → nulls).
  let sourceSheet: {
    source_sheet_url: string | null;
    source_sheet_title: string | null;
    source_sheet_synced_at: string | null;
  } = {
    source_sheet_url: null,
    source_sheet_title: null,
    source_sheet_synced_at: null,
  };
  const sheetRes = await admin
    .from('sched_projects')
    .select('source_sheet_url, source_sheet_title, source_sheet_synced_at')
    .eq('id', projectId)
    .maybeSingle();
  if (!sheetRes.error && sheetRes.data) {
    sourceSheet = sheetRes.data as typeof sourceSheet;
  }

  // Resolve-or-create the inbox pool so uploads/sheet imports have a target
  // batch id up front (명단 진입 = provisioning trigger, D5).
  const inbox = await resolveInboxBatch(
    admin,
    { id: projectId, title: projRes.project.title, org_id: provision.orgId },
    provision.ownerUserId,
  );
  const inboxBatchId = 'batchId' in inbox ? inbox.batchId : null;

  // Batches under this project → group sections + assign targets + their
  // candidates. `is_inbox` is additive → default false on a narrow DB.
  type Batch = { id: string; title: string; is_inbox: boolean };
  let batches: Batch[] = [];
  const wideBatches = await admin
    .from('sched_batches')
    .select('id, title, is_inbox')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (wideBatches.error) {
    const narrowBatches = await admin
      .from('sched_batches')
      .select('id, title')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(500);
    batches = (narrowBatches.data ?? []).map((b) => ({
      ...(b as { id: string; title: string }),
      is_inbox: false,
    }));
  } else {
    batches = (wideBatches.data ?? []) as Batch[];
  }
  const batchIds = batches.map((b) => b.id);
  if (batchIds.length === 0) {
    return NextResponse.json(
      {
        project: { ...projRes.project, ...sourceSheet },
        candidates: [],
        batches,
        inbox_batch_id: inboxBatchId,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // `source` / `status` / `stage` are additive → wide/narrow degrade (default
  // them). Card 588: this route carries `stage` on every candidate but does NOT
  // filter — existing consumers (intake band count) keep seeing every row, and
  // the ①응답 upload-list segment filters `stage === 'intake'` on the client.
  // A preview DB without the column degrades to 'roster' (current behaviour).
  type Candidate = {
    id: string;
    batch_id: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    fields: Record<string, string> | null;
    status: string;
    source: string | null;
    stage: string;
  };
  let candidates: Candidate[] = [];
  const wide = await admin
    .from('sched_candidates')
    .select('id, batch_id, email, name, phone, fields, status, source, stage')
    .in('batch_id', batchIds)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (wide.error) {
    const narrow = await admin
      .from('sched_candidates')
      .select('id, batch_id, email, name, phone, fields, status')
      .in('batch_id', batchIds)
      .order('created_at', { ascending: true })
      .limit(5000);
    candidates = (narrow.data ?? []).map((r) => ({
      ...(r as Omit<Candidate, 'source' | 'stage'>),
      source: null,
      stage: 'roster',
    }));
  } else {
    candidates = (wide.data ?? []) as Candidate[];
  }

  const masked = maskCandidatesBySource(candidates, superadmin);

  return NextResponse.json(
    {
      project: { ...projRes.project, ...sourceSheet },
      candidates: masked,
      batches,
      inbox_batch_id: inboxBatchId,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
