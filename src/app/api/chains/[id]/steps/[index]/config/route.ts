import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { readStepConfig } from '@/lib/chains/registry';
import {
  ACTIVE_STATUSES,
  getChainForOrg,
  isStepConfigEditable,
  patchStepConfig,
} from '@/lib/chains/state';
import {
  mergeStepConfig,
  validateStepConfigPatch,
} from '@/lib/chains/step-config';
import { stepUiMeta } from '@/lib/chains/ui-meta';
import { toChainView } from '@/lib/chains/view';

// PATCH /api/chains/[id]/steps/[index]/config — 체인 **단계 설정** 저장.
//
// ══════════════════════════════════════════════════════════════════════════
// 왜 이 라우트가 있어야 하나
// ══════════════════════════════════════════════════════════════════════════
// CD 체인 인스펙터(design-handoff/chain-inspector/README.md §4.5)는 "고치면
// 자동 저장되고 카드 요약에 즉시 반영된다" 를 전제한다. 그 값을 받을 곳이
// 지금까지 없었다 — `ChainStepInstance` 에 설정 필드 자체가 없었고(필드정의
// §0 구멍 ①), 전사 언어는 어댑터가 하드 기본값으로 넘기고 있었다. 이 라우트가
// 그 저장 경로이고, 소비는 어댑터·kick 쪽에서 같은 PR 로 함께 연결된다
// (저장만 하고 아무도 읽지 않으면 유령 필드를 새로 만드는 것이다).
//
// body = **부분 config**(머지 시맨틱, 전체 교체 아님). 인스펙터는 필드 하나를
// 바꿀 때마다 디바운스 400ms 로 그 필드만 보낸다 — 전체 교체로 받으면 느린
// 왕복 2건이 교차할 때 뒤에 도착한 낡은 스냅샷이 앞선 변경을 지운다.
// `null` 값은 그 키를 비우는 것(RFC 7396) — 선택 필드를 되돌리는 유일한 수단.
//
// 응답 = 갱신된 `ChainView`(+ 원본 row). 프론트가 카드 요약을 다시 그리는 데
// 필요한 것이 뷰이고, 다른 체인 라우트가 전부 `{ chain }` 을 돌려주므로 둘 다
// 싣는다 — 기존 호출부의 응답 해석을 바꾸지 않는다.
//
// 검증 3층 (step-config.ts · ui-meta.ts 가 SSOT):
//   1. 키 화이트리스트 — 그 단계 `inspectorSchema` 의 필드 id 가 아니면 400.
//      통과시켜 jsonb 에 쌓으면 다음 사람이 유효한 설정인지 알 수 없게 된다.
//   2. 쓰기 권한 — `source: 'upstream' | 'chain'` 필드와 dropzone/readonly 는
//      400. 사용자가 정하는 값이 아니다(프로젝트는 체인 설정 — §0 구멍 ②).
//   3. 종류별 값 — 옵션 안의 값 · boolean · 길이/개수 상한(zod, kind 파생).
//
// 잠금: **running·done 단계는 409** — CD §5 클라이언트 잠금의 서버측 대응물
// (클라 잠금만 믿지 않는다). 판별은 `isStepConfigEditable`(state.ts)이 소유하고
// 종결 체인·소비될 일 없는 단계(skipped/error)까지 같이 막는다 — 저장돼도
// 아무도 읽지 않을 설정을 받는 것은 유령 필드를 만드는 일이다.
//
// 경합: 설정 쓰기는 status·커서를 건드리지 않으므로 CAS 술어가 `updated_at`
// 낙관적 토큰이다. 동시 PATCH 2건이면 뒤쪽이 0 행 매칭으로 떨어지고, 여기서
// **다시 읽어 재시도**한다(최대 RETRY_LIMIT). 둘 다 "각자의 필드만" 머지돼
// 살아남는다 — 전체 steps 배열을 낡은 스냅샷으로 덮어쓰는 경로가 없다.
//
// 세션(RLS) 경로 전용 — 설정은 사용자 행위라 CRON_SECRET 내부 경로를 두지
// 않는다. 새 차감 0, 마이그 0(`steps` 는 이미 jsonb).

// 동시 PATCH 로 토큰이 바뀌었을 때의 재시도 횟수. 디바운스된 인스펙터 입력은
// 실제로 교차하므로 1회 실패를 사용자 에러로 올리면 "저장 실패" 가 자주 뜬다.
// 반대로 무한 재시도는 승인/전진과 핑퐁할 수 있어 상한을 둔다 — 넘치면 409.
const RETRY_LIMIT = 3;

const INDEX_MAX = 32;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index: rawIndex } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const stepIndex = Number(rawIndex);
  if (
    !Number.isInteger(stepIndex) ||
    stepIndex < 0 ||
    stepIndex > INDEX_MAX
  ) {
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

  // body 는 평평한 객체 1개. 배열/스칼라/null 은 부분 config 가 아니다.
  const raw: unknown = await req.json().catch(() => null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;

  const admin = createAdminClient();

  for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
    const chain = await getChainForOrg(admin, id, org.org_id);
    if (!chain) {
      return NextResponse.json({ error: 'chain_not_found' }, { status: 404 });
    }
    const step = chain.steps?.[stepIndex];
    if (!step) {
      return NextResponse.json({ error: 'step_not_found' }, { status: 404 });
    }
    // 잠금을 쓰기 시도 전에 명시적으로 — 잠긴 단계에 쓸모 없는 update 를
    // 쏘지 않는다(조립 수정 PATCH 와 동일 패턴). 사유는 두 코드로 가른다:
    // 체인이 끝난 것(`chain_locked` — 조립 수정 라우트와 같은 이름)과 그
    // 단계가 이미 돌고 있거나 끝난 것(`step_locked`). UI 가 "체인이 끝났어요"
    // 와 "이 단계는 실행 중이에요" 를 다르게 말해야 하기 때문이다.
    if (!ACTIVE_STATUSES.includes(chain.status)) {
      return NextResponse.json({ error: 'chain_locked' }, { status: 409 });
    }
    if (!isStepConfigEditable(chain, stepIndex)) {
      return NextResponse.json({ error: 'step_locked' }, { status: 409 });
    }

    // 화이트리스트 + 종류별 검증. **단계 feature 로 스키마를 고른다** — 같은
    // 필드 id 가 다른 단계에서 다르게 검증된다(선언이 SSOT). 레지스트리에
    // 없는 feature 는 row 가 코드와 어긋났다는 뜻이라 추측하지 않고 거절한다.
    const meta = stepUiMeta(step.feature);
    if (!meta) {
      return NextResponse.json(
        { error: 'unknown_step', detail: `${step.feature} is not a chain step` },
        { status: 400 },
      );
    }
    const valid = validateStepConfigPatch(meta, body);
    if (!valid.ok) {
      return NextResponse.json(
        {
          error: valid.error,
          detail: valid.detail,
          field: valid.field,
        },
        { status: 400 },
      );
    }

    const current = readStepConfig(step);
    const next = mergeStepConfig(current, valid.patch);

    // 실제로 달라지는 것이 없으면 쓰지 않는다. 디바운스된 인스펙터는 같은
    // 값을 다시 보내는 일이 흔하고, 무의미한 update 는 `updated_at` 을 bump 해
    // 동시 승인/채택 CAS 를 떨어뜨린다(= 사용자에게는 이유 없는 409).
    if (JSON.stringify(next) === JSON.stringify(current)) {
      return NextResponse.json({ chain, view: toChainView(chain) });
    }

    const result = await patchStepConfig(admin, chain, stepIndex, next);
    if (result.applied) {
      return NextResponse.json({
        chain: result.row,
        view: toChainView(result.row),
      });
    }
    // 읽은 뒤 누군가 이 행을 건드렸다 — 다시 읽어 머지를 재시도한다.
  }

  return NextResponse.json({ error: 'conflict' }, { status: 409 });
}
