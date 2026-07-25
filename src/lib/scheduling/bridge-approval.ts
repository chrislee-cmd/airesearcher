import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { getFormResponses } from '@/lib/google-forms';
import { responsesToCandidates } from './bridge-ingest';
import { upsertCandidatesIntoBatch } from './candidates-upsert';
import {
  resolveOrCreateProjectForForm,
  resolveInboxBatch,
} from './journey-project';

// Bridge auto-ingest (decision D1-A). Fired when a super-admin approves an
// invitation request (PATCH status='sent'): the server reads the selected Google
// Forms responses through the SAME admin-proxy token routing the manual contacts
// view uses, extracts name/phone/email + carries the rest into `fields`, and
// upserts them into the form's project as `source='bridge'` candidates (so their
// contact is masked for the user). PII never leaves the server on this path.
//
// The project is resolved-or-created 1:1 for the form (D5); the target batch is
// the invitation's chosen group when it belongs to that project, else the
// project inbox. dedup reuses the existing multi-key upsert (email>phone>name).
//
// Returns an error (WITHOUT the caller flipping status) on any failure so the
// invitation stays actionable — partial-ingest is surfaced, never silently
// swallowed.

type InvitationRow = {
  form_id: string;
  response_ids: string[];
  requester_user_id: string;
  org_id: string | null;
  target_batch_id: string | null;
};

export type IngestResult =
  | { ok: true; ingested: number; projectId: string; batchId: string }
  | { ok: false; status: number; error: string };

export async function ingestApprovedInvitation(
  admin: SupabaseClient,
  invitationId: string,
): Promise<IngestResult> {
  // 1) Load the invitation. target_batch_id is additive → wide/narrow degrade.
  let inv: InvitationRow | null = null;
  const wide = await admin
    .from('recruiting_invitations')
    .select('form_id, response_ids, requester_user_id, org_id, target_batch_id')
    .eq('id', invitationId)
    .maybeSingle();
  if (wide.error) {
    const narrow = await admin
      .from('recruiting_invitations')
      .select('form_id, response_ids, requester_user_id, org_id')
      .eq('id', invitationId)
      .maybeSingle();
    if (narrow.error || !narrow.data) {
      return { ok: false, status: 500, error: 'invitation_load_failed' };
    }
    inv = { ...(narrow.data as Omit<InvitationRow, 'target_batch_id'>), target_batch_id: null };
  } else if (wide.data) {
    inv = wide.data as InvitationRow;
  }
  if (!inv) return { ok: false, status: 404, error: 'invitation_not_found' };
  if (!inv.response_ids || inv.response_ids.length === 0) {
    return { ok: false, status: 400, error: 'no_responses' };
  }

  // 2) Route a Google token exactly as the form owner would (admin-proxy vs
  //    per-user OAuth) — same path as the manual contacts view.
  const access = await resolveFormAccess(inv.form_id, inv.requester_user_id);
  if (!access.ok) {
    return { ok: false, status: access.status, error: access.error };
  }

  // 3) Read + filter responses to the selected ids.
  let formTitle = '';
  let candidates;
  try {
    const result = await getFormResponses(access.accessToken, inv.form_id);
    formTitle = result.title;
    const wanted = new Set(inv.response_ids);
    const rows = result.rows.filter((r) => wanted.has(r.responseId));
    if (rows.length === 0) {
      return { ok: false, status: 404, error: 'responses_not_found' };
    }
    candidates = responsesToCandidates(result.columns, rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return { ok: false, status: 502, error: msg };
  }

  // 4) Resolve-or-create the form's project (1:1 lazy, D5).
  const projRes = await resolveOrCreateProjectForForm(admin, {
    formId: inv.form_id,
    ownerUserId: inv.requester_user_id,
    title: formTitle,
    orgId: inv.org_id,
  });
  if ('error' in projRes) {
    return { ok: false, status: 500, error: projRes.error };
  }
  const project = projRes.project;

  // 5) Target batch: the invitation's chosen group IF it belongs to this
  //    project, else the project inbox (resolve-or-create).
  let batchId: string | null = null;
  if (inv.target_batch_id) {
    const { data: batch } = await admin
      .from('sched_batches')
      .select('id, project_id')
      .eq('id', inv.target_batch_id)
      .maybeSingle();
    if (batch && (batch as { project_id?: string | null }).project_id === project.id) {
      batchId = (batch as { id: string }).id;
    }
  }
  if (!batchId) {
    const inbox = await resolveInboxBatch(
      admin,
      { id: project.id, title: project.title, org_id: inv.org_id },
      inv.requester_user_id,
    );
    if ('error' in inbox) {
      return { ok: false, status: 500, error: inbox.error };
    }
    batchId = inbox.batchId;
  }

  // 6) Upsert as bridged candidates (server-masked contact downstream).
  const upserted = await upsertCandidatesIntoBatch(
    admin,
    batchId,
    candidates,
    'bridge',
  );
  if ('error' in upserted) {
    return { ok: false, status: 500, error: upserted.error };
  }

  return {
    ok: true,
    ingested: upserted.upserted,
    projectId: project.id,
    batchId,
  };
}
