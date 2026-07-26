import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getFormAnchoredAccess,
  getProjectAnchoredAccess,
} from '@/lib/scheduling/access';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { getFormResponses } from '@/lib/google-forms';
import {
  findConsentColumn,
  filterConsentedRows,
} from '@/lib/recruiting/contact-filter';

export const maxDuration = 30;

// GET /api/scheduling/journey/counts?form_id=...[&project_id=...]
// Per-tab count pills for the fused header (GAP-AUDIT §1-1): 응답 n · 후보 n ·
// 확정 n.
//
// 후보/확정 are DB-cheap (COUNT over the journey's project). 응답 requires the
// Forms API and is BEST-EFFORT — a Google reauth / disconnect returns
// responses:null so the pill degrades gracefully rather than 500-ing the whole
// header. This read is non-mutating: it looks up the project but never provisions
// one (that happens on fullview open / 진입).
//
// TWO ANCHORS (card 583): form_id → form-anchored + real 응답 count; else
// project_id (pill) → project-anchored, responses stays null (no form to poll).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('form_id') ?? '';
  const projectIdParam = searchParams.get('project_id') ?? '';

  // Anchor lookup key: form_id (project's form_id column) or the pill's
  // interview_project_id column. `formOwnerUserId` is set only on the form path
  // so the 응답 Forms API read runs there and stays null form-free.
  let anchorColumn: 'form_id' | 'interview_project_id';
  let anchorValue: string;
  let formOwnerUserId: string | null = null;
  if (formId) {
    const access = await getFormAnchoredAccess(formId);
    if (!access) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    anchorColumn = 'form_id';
    anchorValue = formId;
    formOwnerUserId = access.form.user_id;
  } else if (projectIdParam) {
    const access = await getProjectAnchoredAccess(projectIdParam);
    if (!access) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    anchorColumn = 'interview_project_id';
    anchorValue = access.project.interview_project_id;
  } else {
    return NextResponse.json(
      { error: 'form_id_or_project_id_required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Existing project for this anchor (no create — counts is read-only). The
  // anchor column may be absent on a preview DB → treat as "no project yet".
  let candidateCount = 0;
  let confirmedCount = 0;
  const projRes = await admin
    .from('sched_projects')
    .select('id')
    .eq(anchorColumn, anchorValue)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const projectId = projRes.error ? null : (projRes.data as { id: string } | null)?.id ?? null;

  if (projectId) {
    const { data: batchRows } = await admin
      .from('sched_batches')
      .select('id')
      .eq('project_id', projectId)
      .limit(500);
    const batchIds = (batchRows ?? []).map((b) => (b as { id: string }).id);
    if (batchIds.length > 0) {
      const total = await admin
        .from('sched_candidates')
        .select('id', { count: 'exact', head: true })
        .in('batch_id', batchIds);
      candidateCount = total.count ?? 0;
      const confirmed = await admin
        .from('sched_candidates')
        .select('id', { count: 'exact', head: true })
        .in('batch_id', batchIds)
        .eq('status', 'confirmed');
      confirmedCount = confirmed.error ? 0 : confirmed.count ?? 0;
    }
  }

  // Responses — best-effort, form path only. Mirrors the fullview ① tab's consent
  // filtering so the pill matches what's shown there. Form-free (project_id) has
  // no form to poll → responses stays null (pill hidden).
  let responses: number | null = null;
  if (formId && formOwnerUserId) {
    const formAccess = await resolveFormAccess(formId, formOwnerUserId);
    if (formAccess.ok) {
      try {
        const result = await getFormResponses(formAccess.accessToken, formId);
        const consent = findConsentColumn(result.columns);
        responses = filterConsentedRows(result.rows, consent).length;
      } catch {
        responses = null;
      }
    }
  }

  return NextResponse.json(
    { responses, candidates: candidateCount, confirmed: confirmedCount },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
