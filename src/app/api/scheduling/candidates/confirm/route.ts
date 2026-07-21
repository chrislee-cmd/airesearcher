import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';

// Bulk-confirm candidates (super-admin only). Sets status = 'confirmed' on every
// checked candidate ("개인 확정" bulk action). Non-admins get 404. Same
// service-role write pattern as the other /api/scheduling/* routes.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const rawIds =
    body && typeof body === 'object' && Array.isArray((body as { candidateIds?: unknown }).candidateIds)
      ? (body as { candidateIds: unknown[] }).candidateIds
      : [];
  const candidateIds = rawIds.filter((v): v is string => typeof v === 'string');
  if (candidateIds.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_candidates')
    .update({ status: 'confirmed' })
    .in('id', candidateIds)
    .select('id');
  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { updated: data?.length ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
