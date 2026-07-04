import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { getFormResponses } from '@/lib/google-forms';
import { isContactColumnTitle } from '@/lib/recruiting/contact-filter';
import { isPiiColumn } from '@/lib/recruiting-pii';

export const maxDuration = 60;

// GET /api/recruiting/invitations/[id]/contacts
// Super-admin-only. Returns the UNMASKED responses for the invitation's
// selected respondents so the admin can actually send the invites. This is the
// one authorized path where respondent PII is revealed — every user-facing read
// masks name/phone (src/app/api/recruiting/google/forms/[formId]/responses).
// 404 for non-admins so the route's existence isn't probeable (same pattern as
// the invitations GET/PATCH routes).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: invitation, error } = await admin
    .from('recruiting_invitations')
    .select('form_id, response_ids, requester_user_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[recruiting/invitations/[id]/contacts] load error', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
  if (!invitation) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Route a Google token exactly as the form owner would — resolveFormAccess
  // proves the requester owns the form and picks admin-proxy vs per-user OAuth
  // so the admin and user read paths can never diverge.
  const access = await resolveFormAccess(
    invitation.form_id,
    invitation.requester_user_id,
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const result = await getFormResponses(access.accessToken, invitation.form_id);
    const wanted = new Set(invitation.response_ids);
    const rows = result.rows.filter((r) => wanted.has(r.responseId));
    // Flag contact/PII columns so the client can emphasize them; every column
    // and its real value is sent — this is the admin's authorized full view.
    const contactQuestionIds = result.columns
      .filter((c) => isContactColumnTitle(c.title) || isPiiColumn(c.title))
      .map((c) => c.questionId);
    return NextResponse.json(
      { columns: result.columns, rows, contactQuestionIds },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
