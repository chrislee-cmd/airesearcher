import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';

// Create a scheduling batch (super-admin only). Mirrors the /api/admin/* gate:
// non-admins get 404 (route stays unobservable) and writes go through the
// service-role client after the code-level isSuperAdminEmail check.
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
  const title =
    body && typeof body === 'object' && typeof (body as { title?: unknown }).title === 'string'
      ? (body as { title: string }).title.trim()
      : '';
  if (!title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('sched_batches')
    .insert({ owner_user_id: user!.id, title })
    .select('id, title, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  return NextResponse.json({ batch: data }, { headers: { 'Cache-Control': 'no-store' } });
}
