import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  accessibleCandidateIds,
} from '@/lib/scheduling/access';

export const runtime = 'nodejs';

// Bulk-confirm candidates. Open to super-admin OR org member; non-members get
// 404. Org members can only confirm candidates whose batch owner shares an org
// with them (foreign ids are dropped). Same service-role write pattern.
export async function POST(request: Request) {
  const access = await getSchedulingAccess();
  if (!access) {
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
  const allowedIds = await accessibleCandidateIds(admin, access, candidateIds);
  if (allowedIds.length === 0) {
    return NextResponse.json({ error: 'no_candidates' }, { status: 400 });
  }
  const { data, error } = await admin
    .from('sched_candidates')
    .update({ status: 'confirmed' })
    .in('id', allowedIds)
    .select('id');
  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json(
    { updated: data?.length ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
