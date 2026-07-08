// GET /api/share/mine — 내가 만든(또는 org admin 으로 볼 수 있는) 공유 목록.
//
// 관리 UI(#477)용. RLS(shared_views_select_owner_or_admin)가 가시성을
// 강제하므로 여기서는 별도 필터 없이 조회 + invite 이메일을 붙여 반환.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: shares, error } = await supabase
    .from('shared_views')
    .select(
      'id, token, resource_type, resource_id, org_id, expires_at, revoked_at, created_at',
    )
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (shares ?? []).map((s) => s.id);
  const invitesByShare = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: invites } = await supabase
      .from('shared_view_invites')
      .select('shared_view_id, email')
      .in('shared_view_id', ids);
    for (const inv of invites ?? []) {
      const list = invitesByShare.get(inv.shared_view_id) ?? [];
      list.push(inv.email);
      invitesByShare.set(inv.shared_view_id, list);
    }
  }

  return NextResponse.json({
    shares: (shares ?? []).map((s) => ({
      ...s,
      invited_emails: invitesByShare.get(s.id) ?? [],
    })),
  });
}
