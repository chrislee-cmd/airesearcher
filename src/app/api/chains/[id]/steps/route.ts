import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { instantiateSteps, validateSteps } from '@/lib/chains/registry';
import {
  getChainForOrg,
  isAssemblyEditable,
  replaceChainSteps,
} from '@/lib/chains/state';

// PATCH /api/chains/[id]/steps — 체인의 **조립 수정** (A″).
//
// ══════════════════════════════════════════════════════════════════════════
// 왜 수정 API 인가 — cancel+재생성이 E 집계를 오염시킨다
// ══════════════════════════════════════════════════════════════════════════
// 도킹 레인(D-v3)은 레인이 유효(2단계+ 호환 경로)해지는 순간 체인을 POST 한다.
// B 의 advance 훅이 진입 위젯 완료 시점에 체인을 찾으려면 row 가 세션 완료
// **전에** 존재해야 하기 때문이다. 그래서 "만들어졌지만 아직 실행 전" 인 창이
// 실재하고, 그 창에서 카드를 더 붙이거나 떼는 것은 정상 사용이다.
//
// 그 변경을 cancel + 재생성으로 처리하면 편집 횟수만큼 `cancelled` row 가
// 쌓인다. cancelled 는 E 집계(chain-observability)에서 완주율의 분모에
// 들어가고(사용자가 접은 것도 "완주 못 한" 결과라는 의도된 컨벤션) 상태
// 분포 카드의 한 축이기도 하다 — 즉 **조립 편집 노이즈가 파일럿 평가
// 데이터로 둔갑한다.** 그래서 row 를 그 자리에서 고친다: 조립을 몇 번
// 고치든 DB row 는 1개로 유지된다.
// ══════════════════════════════════════════════════════════════════════════
//
// body `{ steps: string[] }` — A′(POST)와 **같은 `validateSteps` 를 권위
// 재실행**한다. 판정 SSOT 는 registry 모듈 하나이고, 프론트 드롭 가드도 같은
// 함수를 쓴다(API 로 노출하지 않는다). 실패 코드는 A′ 와 동일
// (too_short / unknown_step / duplicate_step / incompatible_steps).
//
// 비잠금 한정 — `isAssemblyEditable`(state.ts)이 "아직 아무것도 시작되지
// 않음" 을 판별한다. 잠금 중(승인됨·실행 중·종결·잔액 정지)이면 409
// `chain_locked`. 경합(수정 vs 승인/건너뛰기/종료/sweep 동시)은 3중 CAS
// (status · current_step · updated_at 토큰)로 **1승만** 통과하고, 진 쪽도
// 409 `chain_locked` 를 받는다 — 둘 중 하나가 조용히 덮어쓰는 경로가 없다.
//
// 세션(RLS) 경로 전용 — 조립은 사용자 행위이므로 CRON_SECRET 내부 경로를
// 두지 않는다. 새 차감 0(각 단계가 자기 차감 지점을 소유한다), 마이그 0.

const PatchBody = z.object({
  // 교체할 전체 시퀀스. 런타임 세밀 검증은 validateSteps 가 한다(enum 하드코딩
  // 대신 레지스트리 SSOT 참조). 빈 배열은 여기서 막지 않고 validateSteps 의
  // too_short 로 떨어뜨린다 — A′ 와 같은 코드가 나가게.
  steps: z.array(z.string().min(1)),
});

export async function PATCH(
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

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // 권위 재검증 — 프론트 드롭 가드가 통과시킨 시퀀스라도 서버가 다시 판정한다.
  // from/to 는 incompatible_steps 에서 "어느 쌍이 막혔는지" 를 UI 가 detail
  // 문구를 파싱하지 않고 자기 로케일로 조립할 수 있게 구조로 넘긴다.
  const valid = validateSteps(parsed.data.steps);
  if (!valid.ok) {
    return NextResponse.json(
      {
        error: valid.error,
        detail: valid.detail,
        ...(valid.from ? { from: valid.from } : {}),
        ...(valid.to ? { to: valid.to } : {}),
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const chain = await getChainForOrg(admin, id, org.org_id);
  if (!chain) {
    return NextResponse.json({ error: 'chain_not_found' }, { status: 404 });
  }

  // 잠금 판별을 CAS 전에 한 번 더 명시적으로 — 409 의 사유를 "잠금" 과
  // "경합에서 짐" 으로 가르지 않고 같은 코드로 돌려주되(사용자에게는 둘 다
  // "지금은 수정할 수 없다" 로 같다), 잠금인 경우 쓸모 없는 update 를 쏘지
  // 않는다.
  if (!isAssemblyEditable(chain)) {
    return NextResponse.json({ error: 'chain_locked' }, { status: 409 });
  }

  // 새 steps 인스턴스화. 비용은 표시 시점 FEATURE_COSTS 스냅샷(가격 SSOT) —
  // 아직 어떤 단계도 승인·착수되지 않았으므로 이 조립의 고지값은 지금 값이다.
  // 첫 단계(커서 0)를 체인 status 의 미러(awaiting_approval)로 두는 것은 생성
  // 라우트와 동일한 규칙 — 활성 단계 = 체인 status 미러.
  const steps = instantiateSteps(valid.features);
  steps[0] = { ...steps[0], status: 'awaiting_approval' };

  const result = await replaceChainSteps(admin, chain, steps);
  if (!result.applied) {
    // 읽은 뒤 승인/건너뛰기/종료/sweep 이 끼어들었다 — 저쪽이 이겼다(멱등).
    return NextResponse.json({ error: 'chain_locked' }, { status: 409 });
  }

  return NextResponse.json({ chain: result.row });
}
