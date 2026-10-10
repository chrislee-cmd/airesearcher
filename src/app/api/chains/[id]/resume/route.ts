import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getChainForOrg, casChain } from '@/lib/chains/state';
import { kickCurrentStep, type KickOutcome } from '@/lib/chains/advance';

// POST /api/chains/[id]/resume — 크레딧 부족으로 멈춘 체인 재개.
//
// 왜 신설인가(PR-D): A/B 는 `paused_insufficient_credits` 로 **들어가는** 길만
// 만들었다(advance.ts 402 분기). CD B5 는 그 상태에서 [💎 충전하기] 주 버튼 +
// [재개] 보조 버튼을 그리므로, 나오는 길이 없으면 멈춘 체인이 영구 사물이 된다
// (chain-sweep 이 24h 뒤 닫는 것이 유일한 출구). approve 는
// `awaiting_approval` 만 받으므로 재사용할 수 없다.
//
// paused_insufficient_credits → running 멱등 CAS 후 현재 단계를 다시 kick.
// 충전 없이 재개하면 어댑터가 또 402 를 받아 **같은 멈춤으로 되돌아온다**
// (B5 note: "워커: resume() 이 다시 실패하면 이 상태 유지") — kick 내부의
// insufficientCredits 분기가 running → paused 로 되돌려 놓으므로 별도 처리가
// 필요 없다. 응답은 최신 행 + kick 결과를 함께 돌려줘 조용한 실패를 만들지
// 않는다(R9).

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
  if (chain.status !== 'paused_insufficient_credits') {
    return NextResponse.json({ error: 'not_paused' }, { status: 409 });
  }

  // 커서를 CAS 술어에 포함 — 동시 resume 2회에서 1회만 통과해 중복 kick 을 막는다.
  const result = await casChain(
    admin,
    chain.id,
    'paused_insufficient_credits',
    { status: 'running', error_message: null },
    chain.current_step,
  );
  if (!result.applied) {
    return NextResponse.json({ error: 'not_paused' }, { status: 409 });
  }

  let kick: KickOutcome = 'error';
  try {
    kick = await kickCurrentStep(admin, result.row);
  } catch (e) {
    console.warn('[chains/resume] kick failed', id, e);
  }

  const latest = await getChainForOrg(admin, id, org.org_id);
  return NextResponse.json({ chain: latest ?? result.row, kick });
}
