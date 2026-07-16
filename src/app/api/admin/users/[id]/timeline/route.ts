import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { logAudit } from '@/lib/audit';
import { getUserTimeline } from '@/lib/admin/user-timeline';

// Super-admin-only per-user activity timeline (the "user observation"
// drawer). Returns 404 (not 403) for non-admins so the route isn't
// probeable — matches /api/admin/analytics.
//
// ⚠️ Privacy departure: unlike the rest of /admin/analytics (aggregate
// counts only), this reads raw per-user rows. Every drawer open (first
// page, before == null) is written to audit_log as an admin_action so the
// access is accountable. Read-only — no user data is mutated.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const before = url.searchParams.get('before');
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  // Resolve the viewed user's email (summary header + audit metadata).
  const admin = createAdminClient();
  const { data: viewed } = await admin.auth.admin.getUserById(id);
  const viewedEmail = viewed?.user?.email ?? null;

  const timeline = await getUserTimeline(id, { before, limit, email: viewedEmail });

  // Audit only the drawer open (first page), not every "더보기" — the open
  // is the meaningful per-user access event. user_id is left null so this
  // access row never pollutes the *viewed* user's own timeline; the target
  // is captured as resource_id instead.
  if (before == null) {
    await logAudit({
      event_type: 'admin_action',
      user_id: null,
      actor_email: user?.email ?? null,
      resource_type: 'user_timeline',
      resource_id: id,
      metadata: { viewed_email: viewedEmail, events: timeline.events.length },
      request,
    });
  }

  return NextResponse.json(timeline, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
