import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getChainForOrg, cancelChain } from '@/lib/chains/state';

// POST /api/chains/[id]/cancel — 체인 종료.
//
// 활성 상태(running / awaiting_approval / paused_insufficient_credits) 중
// 어느 것에서든 cancelled 로(멱등 CAS, 현재 status 를 expected 로). 이미 종결
// 된 체인이면 409(멱등). 종료 후 같은 프로젝트에 새 체인을 시작할 수 있다
// (활성 제외 → partial unique index 해제).

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

  const result = await cancelChain(admin, chain);
  if (!result.applied) {
    return NextResponse.json({ error: 'not_active' }, { status: 409 });
  }

  return NextResponse.json({ chain: result.row });
}
