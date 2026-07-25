import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormAnchoredAccess } from '@/lib/scheduling/access';
import { resolveOrCreateProjectForForm } from '@/lib/scheduling/journey-project';
import { maskCandidatesBySource } from '@/lib/scheduling/candidate-masking';

export const maxDuration = 30;

// GET /api/scheduling/journey/candidates?form_id=...
// The 명단 tab's candidate read path. Resolve-or-creates the form's project
// (명단 진입 = provisioning trigger, D5) then returns its candidates with
// SOURCE-BASED CONTACT MASKING enforced server-side: 'bridge' rows have their
// phone/email replaced with ●●●● for non-super-admins; upload/sheet/legacy rows
// stay plaintext (the user's own data). Gate = form-anchored access.
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

  // Batches under this project → their candidates.
  const { data: batchRows } = await admin
    .from('sched_batches')
    .select('id')
    .eq('project_id', projectId)
    .limit(500);
  const batchIds = (batchRows ?? []).map((b) => (b as { id: string }).id);
  if (batchIds.length === 0) {
    return NextResponse.json(
      { project: projRes.project, candidates: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // `source` / `status` are additive → wide/narrow degrade (default them).
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
  const wide = await admin
    .from('sched_candidates')
    .select('id, batch_id, email, name, phone, fields, status, source')
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
      ...(r as Omit<Candidate, 'source'>),
      source: null,
    }));
  } else {
    candidates = (wide.data ?? []) as Candidate[];
  }

  const masked = maskCandidatesBySource(candidates, access.superadmin);

  return NextResponse.json(
    { project: projRes.project, candidates: masked },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
