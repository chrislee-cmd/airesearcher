import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getChainForOrg, skipStep } from '@/lib/chains/state';

// POST /api/chains/[id]/skip — 현재 단계를 건너뛰고 다음 단계로.
//
// 현재 단계 skipped 마킹 + 커서 이동(멱등 CAS). 다음 단계가 있으면 approve
// 모드는 다시 awaiting_approval, auto 는 running. 남은 단계가 없으면 체인 done.
// awaiting_approval 상태에서만 유효.

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

  const result = await skipStep(admin, chain);
  if (!result.applied) {
    return NextResponse.json(
      { error: 'not_awaiting_approval' },
      { status: 409 },
    );
  }

  return NextResponse.json({ chain: result.row });
}
