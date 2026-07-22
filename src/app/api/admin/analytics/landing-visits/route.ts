import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  getLandingVisitDetail,
  isValidLandingDay,
} from '@/lib/admin/analytics';

// Super-admin-only drill-down for card #499: the individual landing_visits
// rows behind one Asia/Seoul day of the 접속자 추이 chart. Returns 404 (not
// 403) for non-admins so the route's existence isn't probeable — matches the
// sibling /api/admin/analytics gate. Unlike that aggregate route this returns
// raw rows, but only the operator-facing fields (country·referrer·UTM·session·
// 시각) — never a raw IP (not stored) or user_agent (out of scope).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const day = params.get('day');
  if (!isValidLandingDay(day)) {
    return NextResponse.json(
      { error: 'invalid_day' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const detail = await getLandingVisitDetail(day);
  return NextResponse.json(detail, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
