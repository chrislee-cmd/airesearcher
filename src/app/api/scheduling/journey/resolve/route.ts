import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormAnchoredAccess } from '@/lib/scheduling/access';
import {
  resolveOrCreateProjectForForm,
  resolveInboxBatch,
} from '@/lib/scheduling/journey-project';

export const maxDuration = 30;

// POST /api/scheduling/journey/resolve  { form_id }
// Form↔project 1:1 lazy provisioning (D5). Called when the recruiting fullview
// opens so the header master-link chip + 명단 tab have a project to hang on. Gate
// = super-admin OR form owner OR their org member (form-anchored). Idempotent:
// returns the existing project once created.
const Body = z.object({ form_id: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const access = await getFormAnchoredAccess(parsed.data.form_id);
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

  const inbox = await resolveInboxBatch(
    admin,
    { id: projRes.project.id, title: projRes.project.title, org_id: access.form.org_id },
    access.form.user_id,
  );

  return NextResponse.json(
    {
      project: projRes.project,
      inbox_batch_id: 'batchId' in inbox ? inbox.batchId : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
