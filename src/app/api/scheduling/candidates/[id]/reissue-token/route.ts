// POST /api/scheduling/candidates/[id]/reissue-token
//   → { participant_token } (super-admin only)
//
// Rotates a candidate's participant_token, invalidating the previously shared
// link (e.g. a link sent to the wrong person). Same gate as the other
// /api/scheduling/* routes: non-admins get 404 and the write goes through the
// service-role client after isSuperAdminEmail. gen_random_uuid()::text matches
// the column default so the new token has the same shape as a freshly-uploaded
// candidate's.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getSchedulingAccess,
  ownerOfCandidate,
  ownerAllowed,
} from '@/lib/scheduling/access';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const access = await getSchedulingAccess();
  if (!access) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!access.superadmin) {
    const owner = await ownerOfCandidate(admin, id);
    if (!ownerAllowed(access, owner)) {
      return NextResponse.json({ error: 'candidate_not_found' }, { status: 404 });
    }
  }
  const { data, error } = await admin
    .from('sched_candidates')
    .update({ participant_token: randomUUID() })
    .eq('id', id)
    .select('id, participant_token')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'candidate_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { participant_token: data.participant_token },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
