import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminAnalytics, parseAnalyticsQuery } from '@/lib/admin/analytics';

// Super-admin-only native analytics aggregator. Returns 404 (not 403) for
// non-admins so the route's existence isn't probeable — matches the
// /api/admin/api-usage gate. Response is pre-aggregated counts only; no
// raw rows or PII ever leave the server.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const query = parseAnalyticsQuery(new URL(request.url).searchParams);
  const report = await getAdminAnalytics(query);
  return NextResponse.json(report, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
