import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getLatestSnapshot } from '@/lib/admin/snapshots';

// GET — latest baseline snapshot (or null on first run). Non-admins get
// 404 so the route isn't probeable.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const snapshot = await getLatestSnapshot();
  return NextResponse.json(
    { snapshot },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
