// POST /api/scheduling/projects/[id]/rotate-share
//   → { share_token } (super-admin only)
//
// Rotates a project's share_token, invalidating the previously shared COMMON
// link (e.g. it leaked to the wrong audience). Replaces the old per-candidate
// reissue-token flow now that the link is one project-level URL (BUILD-SPEC
// §5.1). Same gate as the other /api/scheduling/* routes: non-admins get 404 and
// the write goes through the service-role client after isSuperAdminEmail.
// randomUUID() matches the column default so the new token has the same shape.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_projects')
    .update({ share_token: randomUUID() })
    .eq('id', id)
    .select('id, share_token')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { share_token: data.share_token },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
