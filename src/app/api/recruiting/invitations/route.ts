import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const maxDuration = 30;

// POST /api/recruiting/invitations
// A user files a request to invite a set of respondents. Contact info is never
// exposed to the user — this only records which responses they want invited.
// No credits are charged: the super admin fulfils the request out-of-band.
const Body = z.object({
  form_id: z.string().min(1),
  project_id: z.string().uuid().nullable().optional(),
  response_ids: z.array(z.string().min(1)).min(1).max(500), // cap guards bulk abuse
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Insert through the user's RLS client — the invitations_self_insert policy
  // enforces requester_user_id = auth.uid(), so a request can't be forged for
  // someone else.
  const { data, error } = await supabase
    .from('recruiting_invitations')
    .insert({
      org_id: org.org_id,
      requester_user_id: user.id,
      project_id: parsed.data.project_id ?? null,
      form_id: parsed.data.form_id,
      response_ids: parsed.data.response_ids,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[recruiting/invitations] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    count: parsed.data.response_ids.length,
  });
}

// GET /api/recruiting/invitations?status=pending
// Super-admin-only listing of every invitation request, enriched with the
// requester's profile and the form title. Returns 404 for non-admins so the
// route's existence isn't probeable (same pattern as /api/admin/payments).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') ?? 'all';

  const admin = createAdminClient();
  const query = admin
    .from('recruiting_invitations')
    .select(
      'id, org_id, requester_user_id, project_id, form_id, response_ids, status, admin_note, created_at, processed_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (statusFilter !== 'all') {
    query.eq('status', statusFilter);
  }

  const { data: invitations, error } = await query;
  if (error) {
    console.error('[recruiting/invitations] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }

  const rows = invitations ?? [];

  // Enrich in two follow-up batches rather than a PostgREST embed. Neither
  // profiles nor recruiting_forms has a direct FK from recruiting_invitations,
  // and PostgREST silently returns 0 rows for transitive-FK embeds
  // (PROJECT.md §7.10), so we resolve them with explicit .in() lookups.
  const userIds = [...new Set(rows.map((r) => r.requester_user_id))];
  const formIds = [...new Set(rows.map((r) => r.form_id))];

  const [profilesRes, formsRes] = await Promise.all([
    userIds.length
      ? admin.from('profiles').select('id, email, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; email: string | null; full_name: string | null }[] }),
    formIds.length
      ? admin.from('recruiting_forms').select('form_id, title').in('form_id', formIds)
      : Promise.resolve({ data: [] as { form_id: string; title: string }[] }),
  ]);

  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p]),
  );
  const formTitleById = new Map(
    (formsRes.data ?? []).map((f) => [f.form_id, f.title]),
  );

  const enriched = rows.map((r) => ({
    ...r,
    requester: profileById.get(r.requester_user_id) ?? null,
    form_title: formTitleById.get(r.form_id) ?? null,
  }));

  return NextResponse.json(
    { invitations: enriched },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
