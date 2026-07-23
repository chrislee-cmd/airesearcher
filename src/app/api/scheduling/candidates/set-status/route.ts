import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';

// Bulk-set candidate status (super-admin only). Generalizes the "개인 확정"
// (/confirm) bulk action to any of the coarse per-candidate states — used by the
// list's 소통중(communicating) action (recsched 항목4). `status` is validated
// against the same set the DB CHECK enforces so an unknown value can't slip in.
// Non-admins get 404. Same service-role write pattern as /confirm.
const ALLOWED_STATUSES = ['pending', 'confirmed', 'communicating'] as const;
type CandidateStatus = (typeof ALLOWED_STATUSES)[number];

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

  const status = (body as { status?: unknown }).status;
  if (
    typeof status !== 'string' ||
    !ALLOWED_STATUSES.includes(status as CandidateStatus)
  ) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_candidates')
    .update({ status })
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
