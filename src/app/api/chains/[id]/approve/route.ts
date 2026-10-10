import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getChainForOrg, approveChain } from '@/lib/chains/state';
import { kickCurrentStep, type KickOutcome } from '@/lib/chains/advance';

// POST /api/chains/[id]/approve — 승인 대기 체인의 현재 단계를 승인.
//
// awaiting_approval → running 전이(멱등 CAS). 동시 approve 2회면 CAS 로 1회만
// 적용되고 두 번째는 409(conflict) — 중복 kick 방지(리스크 R1).
//
// 전이 성공 직후 **실제 위젯 job 착수(kick)** 까지 수행한다(PR-B — A 의 스텁
// 대체). 승인 = "이 단계를 지금 돌려라" 이므로 전이만 하고 끝내면 체인이
// running 에 멈춰 있다가 chain-sweep 에 닫힌다.
//
// kick 실패는 승인 전이를 되돌리지 않는다 — 사유는 체인 status(paused/error)와
// steps[].error 에 기록되고 응답의 `kick` 에 요약된다(조용한 실패 금지, R9).
// 진입 단계처럼 서버가 착수할 것이 없는 단계는 kick='manual' — 사용자가 위젯
// UI 에서 직접 수행하고, 그 완료 훅이 체인을 다시 전진시킨다.
//
// Body `{ project_id? }` (PR-D) — CD B3 의 프로젝트 선택은 **승인과 같은 순간**에
// 일어난다("별도 스텝·모달을 만들지 않는다"). 프로빙 진입 체인은 project_id 가
// null 이고 인제스트/탑라인 단계는 프로젝트를 요구하므로(adapters R8), 승인 요청이
// 선택된 프로젝트를 함께 싣는다. 이미 귀속된 체인은 덮어쓰지 않는다(아래 is-null
// 가드) — 별도 PATCH 라우트를 새로 만드는 대신 승인에 합친 이유도 같다: 선택은
// 승인의 일부지 독립 상태 전이가 아니다.

const Body = z.object({
  project_id: z.string().uuid().optional(),
});

export async function POST(
  req: Request,
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

  // body 는 없을 수 있다(기존 호출부는 빈 POST) — 파싱 실패는 빈 객체로 취급.
  const parsedBody = Body.safeParse(await req.json().catch(() => ({})));
  const pickedProjectId = parsedBody.success
    ? parsedBody.data.project_id
    : undefined;

  const admin = createAdminClient();
  let chain = await getChainForOrg(admin, id, org.org_id);
  if (!chain) {
    return NextResponse.json({ error: 'chain_not_found' }, { status: 404 });
  }

  // B3 — 미귀속 체인에 프로젝트를 못박는다. 이 org 소유인지 먼저 확인하고(정보
  // 누출 방지), project_id is null 조건으로만 적용해 경합에서도 덮어쓰지 않는다.
  if (pickedProjectId && chain.project_id === null) {
    const { data: projectRow } = await admin
      .from('interview_projects')
      .select('id')
      .eq('id', pickedProjectId)
      .eq('org_id', org.org_id)
      .maybeSingle();
    if (!projectRow) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    const { data: bound } = await admin
      .from('widget_chains')
      .update({ project_id: pickedProjectId })
      .eq('id', chain.id)
      .is('project_id', null)
      .select()
      .maybeSingle();
    // 적용되면 갱신된 행으로 승인/kick 을 진행해야 어댑터가 프로젝트를 본다.
    if (bound) chain = bound as typeof chain;
  }

  const result = await approveChain(admin, chain);
  if (!result.applied) {
    // 이미 전이됐거나(경합) 승인 대기 상태가 아님 — 멱등하게 409.
    return NextResponse.json(
      { error: 'not_awaiting_approval' },
      { status: 409 },
    );
  }

  // 승인된 현재 단계를 착수. 예외는 흡수한다 — 승인 자체는 이미 커밋됐고,
  // 여기서 500 을 던지면 사용자는 "승인이 실패했다"고 오해해 재시도하지만
  // CAS 때문에 409 만 받는다(회복 불가 오인). 대신 outcome 을 돌려준다.
  let kick: KickOutcome = 'error';
  try {
    kick = await kickCurrentStep(admin, result.row);
  } catch (e) {
    console.warn('[chains/approve] kick failed', id, e);
  }

  // kick 이 체인 status 를 바꿨을 수 있다(paused/error/done) — 최신 행을 돌려
  // 클라이언트가 realtime 이벤트를 기다리지 않고도 결과를 바로 반영하게 한다.
  const latest = await getChainForOrg(admin, id, org.org_id);
  return NextResponse.json({ chain: latest ?? result.row, kick });
}
