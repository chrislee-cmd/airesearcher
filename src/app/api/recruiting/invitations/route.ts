import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { ingestApprovedInvitation } from '@/lib/scheduling/bridge-approval';

// Direct ingest runs inline here (reads Google Forms + upserts candidates), so
// this route needs the longer budget the approval PATCH already uses.
export const maxDuration = 60;

// POST /api/recruiting/invitations
// A user files a request to invite a set of respondents. Contact info is never
// exposed to the user — this only records which responses they want invited.
// No credits are charged.
//
// D1-A revision (2026-07-25, 사용자 결정): the super-admin approval gate is
// retired. Pressing "명단으로 보내기" now ingests candidates into the form's
// project in this SAME request — no waiting for approval. The invitation row is
// kept as an audit trail and auto-stamped `sent`. The PII contract is UNCHANGED:
// ingest is server-only (admin-proxy), contact stays masked (●●●●) for the user.
// The super-admin PATCH path is left intact and idempotent (re-approval re-runs
// the dedup upsert harmlessly) for legacy/admin re-processing.
const Body = z.object({
  form_id: z.string().min(1),
  project_id: z.string().uuid().nullable().optional(),
  response_ids: z.array(z.string().min(1)).min(1).max(500), // cap guards bulk abuse
  // Journey bridge target: an explicit candidate group (batch) to ingest into on
  // approval, or 'inbox' / omitted → the form's project inbox (resolve-or-create).
  target_batch_id: z.string().uuid().nullable().optional(),
  target: z.literal('inbox').optional(),
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

  // target='inbox' (or omitted) → null; an explicit batch id → that batch.
  const targetBatchId =
    parsed.data.target === 'inbox' ? null : parsed.data.target_batch_id ?? null;

  // Insert through the user's RLS client — the invitations_self_insert policy
  // enforces requester_user_id = auth.uid(), so a request can't be forged for
  // someone else. target_batch_id is additive; on a preview DB lacking the
  // column the wide insert errors and we retry without it (wide/narrow degrade).
  const baseRow = {
    org_id: org.org_id,
    requester_user_id: user.id,
    project_id: parsed.data.project_id ?? null,
    form_id: parsed.data.form_id,
    response_ids: parsed.data.response_ids,
    status: 'pending' as const,
  };
  let insert = await supabase
    .from('recruiting_invitations')
    .insert({ ...baseRow, target_batch_id: targetBatchId })
    .select('id')
    .single();
  // Only degrade to the narrow insert when target_batch_id is genuinely absent
  // (42703 / PGRST204). Retrying on ANY error just re-ran the same failing insert
  // and buried the real cause under "insert_failed" — round-2 feedback #2a. Now a
  // non-missing-column error (RLS with-check, FK, response_ids format) surfaces
  // verbatim below instead of being masked by a pointless retry.
  if (insert.error) {
    const code = insert.error.code;
    const missingTargetBatch =
      code === '42703' ||
      (code === 'PGRST204' && /target_batch_id/.test(insert.error.message ?? ''));
    if (missingTargetBatch) {
      insert = await supabase
        .from('recruiting_invitations')
        .insert(baseRow)
        .select('id')
        .single();
    }
  }
  const { data, error } = insert;

  if (error) {
    console.error('[recruiting/invitations] insert error', error);
    // Surface the real Postgres code + message so a failing preview is
    // diagnosable at the UI (per spec: "에러를 삼키지 말고 노출"). This route is
    // auth-gated (requester = auth.uid()); the DB error carries no secrets.
    return NextResponse.json(
      {
        error: 'insert_failed',
        code: error.code ?? null,
        detail: error.message ?? null,
      },
      { status: 500 },
    );
  }

  // D1-A direct ingest — run in the SAME request (no approval wait). Uses the
  // service-role admin client; `ingestApprovedInvitation` internally routes the
  // form owner's Google token and enforces form access (resolveFormAccess), so a
  // requester without form access is still rejected here (the audit row stays
  // pending, actionable via the admin PATCH path). On success we stamp the
  // invitation `sent` so its status reflects the completed ingest.
  const admin = createAdminClient();
  const ingest = await ingestApprovedInvitation(admin, data.id);
  if (!ingest.ok) {
    return NextResponse.json(
      { error: 'ingest_failed', reason: ingest.error, id: data.id },
      { status: ingest.status },
    );
  }

  // Audit stamp — non-fatal. The candidates are already ingested; a failed
  // status update shouldn't fail the user's action (the PATCH path can still
  // reconcile). The upsert is idempotent so a stale `pending` row is harmless.
  const stamp = await admin
    .from('recruiting_invitations')
    .update({ status: 'sent', processed_at: new Date().toISOString() })
    .eq('id', data.id);
  if (stamp.error) {
    console.error('[recruiting/invitations] audit stamp failed', stamp.error);
  }

  return NextResponse.json({
    id: data.id,
    count: parsed.data.response_ids.length,
    ingested: ingest.ingested,
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
