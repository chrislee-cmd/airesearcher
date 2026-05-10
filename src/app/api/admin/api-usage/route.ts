import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminUsageReport } from '@/lib/admin/providers';

// Admin-only aggregator. Returns 404 (not 403) for non-admins so the
// route's existence isn't probeable from outside.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const report = await getAdminUsageReport();
  return NextResponse.json(report, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
