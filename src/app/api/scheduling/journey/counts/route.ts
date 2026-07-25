import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormAnchoredAccess } from '@/lib/scheduling/access';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { getFormResponses } from '@/lib/google-forms';
import {
  findConsentColumn,
  filterConsentedRows,
} from '@/lib/recruiting/contact-filter';

export const maxDuration = 30;

// GET /api/scheduling/journey/counts?form_id=...
// Per-tab count pills for the fused header (GAP-AUDIT §1-1): 응답 n · 후보 n ·
// 확정 n. Gate = form-anchored access.
//
// 후보/확정 are DB-cheap (COUNT over the form's project). 응답 requires the Forms
// API and is BEST-EFFORT — a Google reauth / disconnect returns responses:null so
// the pill degrades gracefully rather than 500-ing the whole header. This read is
// non-mutating: it looks up the project by form_id but never provisions one (that
// happens on fullview open / 명단 진입).
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

  // Existing project for this form (no create — counts is read-only). form_id
  // column may be absent on a preview DB → treat as "no project yet".
  let candidateCount = 0;
  let confirmedCount = 0;
  const projRes = await admin
    .from('sched_projects')
    .select('id')
    .eq('form_id', formId)
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

  // Responses — best-effort. Mirrors the fullview ① tab's consent filtering so
  // the pill matches what's shown there.
  let responses: number | null = null;
  const formAccess = await resolveFormAccess(formId, access.form.user_id);
  if (formAccess.ok) {
    try {
      const result = await getFormResponses(formAccess.accessToken, formId);
      const consent = findConsentColumn(result.columns);
      responses = filterConsentedRows(result.rows, consent).length;
    } catch {
      responses = null;
    }
  }

  return NextResponse.json(
    { responses, candidates: candidateCount, confirmed: confirmedCount },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
