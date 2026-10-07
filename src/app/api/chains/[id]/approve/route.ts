import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getChainForOrg, approveChain } from '@/lib/chains/state';

// POST /api/chains/[id]/approve — 승인 대기 체인의 현재 단계를 승인.
//
// awaiting_approval → running 전이(멱등 CAS). 동시 approve 2회면 CAS 로 1회만
// 적용되고 두 번째는 409(conflict) — 중복 kick 방지(리스크 R1).
//
// ⚠️ kick 스텁: 이 PR(A)은 상태 전이까지만 한다. 전이 성공 직후 **실제 위젯
// job 착수(kick)는 후속 B(advance 훅)가 연결**한다. 현재는 running 으로만 두고
// 반환 — 다음 단계는 자동으로 돌지 않는다.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const admin = createAdminClient();
  const chain = await getChainForOrg(admin, id, org.org_id);
  if (!chain) {
    return NextResponse.json({ error: 'chain_not_found' }, { status: 404 });
  }

  const result = await approveChain(admin, chain);
  if (!result.applied) {
    // 이미 전이됐거나(경합) 승인 대기 상태가 아님 — 멱등하게 409.
    return NextResponse.json(
      { error: 'not_awaiting_approval' },
      { status: 409 },
    );
  }

  // TODO(B): 여기서 다음 단계 위젯 job 을 kick 한다(advance 훅). 현재는 스텁.
  return NextResponse.json({ chain: result.row });
}
