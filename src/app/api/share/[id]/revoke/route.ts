// POST /api/share/[id]/revoke — 공유 링크 즉시 무효화(revoked_at 설정).
//
// 게이트(assertInvitedViewer)가 revoked_at 을 최우선 검사하므로, 이 호출
// 직후부터 링크는 죽는다(만료 전이라도). 권한은 RLS
// (shared_views_update_owner_or_admin)가 강제 — 생성자 또는 org admin.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 이미 폐기됐으면 그대로 두고 멱등 성공(revoked_at 유지). RLS 가 update
  // 대상 가시성을 좁히므로, 못 보면 0 rows → not_found.
  const { data, error } = await supabase
    .from('shared_views')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!data) {
    // 이미 폐기됐거나(=멱등) 관리 권한 없음. 현재 상태를 재조회해 구분.
    const { data: existing } = await supabase
      .from('shared_views')
      .select('id, revoked_at')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, revoked_at: existing.revoked_at });
  }
  return NextResponse.json({ ok: true, revoked_at: data.revoked_at });
}
