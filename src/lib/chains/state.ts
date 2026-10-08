import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChainStepInstance } from './registry';

// 위젯 체인 — 상태 전이 헬퍼 (멱등 CAS).
//
// 모든 전이는 Compare-And-Swap: `update ... where id=? and status=<expected>`.
// 경합(동시 approve 2회, webhook+poll 동시 done 등)에서 **정확히 1회만** 적용
// 되게 하는 리스크 R1 의 기반. 두 번째 호출은 status 가 이미 바뀌어 0 행 매칭
// → no-op 으로 조용히 떨어진다(에러 아님). B(advance 훅)가 이 모듈을 그대로
// 재사용한다.
//
// 이 모듈은 **순수 상태 전이만** 한다 — 실제 위젯 kick(다음 단계 job 착수)은
// 호출부(B)의 몫. A 의 approve 라우트는 전이까지만(kick 스텁).

export type ChainStatus =
  | 'running'
  | 'awaiting_approval'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'paused_insufficient_credits';

export type ChainRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  created_by: string;
  mode: 'approve' | 'auto';
  template: string;
  steps: ChainStepInstance[];
  current_step: number;
  status: ChainStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const CHAINS_TABLE = 'widget_chains';

// 체인이 아직 종결되지 않은(활성) 상태 집합. 프로젝트당-1-활성 제약과 동일 정의.
export const ACTIVE_STATUSES: readonly ChainStatus[] = [
  'running',
  'awaiting_approval',
  'paused_insufficient_credits',
];

// 전이 결과. applied=false 는 에러가 아니라 "경합에서 졌다/이미 전이됨"(멱등).
export type CasResult =
  | { applied: true; row: ChainRow }
  | { applied: false; reason: 'conflict' | 'not_found' };

// CAS 코어 — status 가 expected 인 동안에만 patch 를 적용. 적용되면 갱신된
// 행을 돌려준다. 0 행 매칭(status 가 이미 다름)이면 applied:false('conflict').
// patch 에는 다음 status / current_step / steps / error_message 등을 담는다.
//
// expectedCurrentStep (선택) — status 만으로는 가를 수 없는 전이를 위한 2차
// 비교 대상. auto 모드의 단계 진행은 `running → running` 이라 status 가 변하지
// 않으므로, status 만 비교하면 동시 done 이벤트(webhook+poll 경합) 둘 다
// 통과해 커서를 두 칸 밀어버린다. 커서를 CAS 술어에 넣으면 선승 1회만
// 통과한다(리스크 R1). 생략하면 status-only CAS — A 의 사용자 액션 전이
// (approve/skip/cancel)는 status 가 반드시 바뀌므로 그대로 안전하다.
//
// expectedUpdatedAt (선택) — 행 전체의 낙관적 잠금 토큰. updated_at 은 DB
// 트리거가 **모든 update 에서** 갱신하므로, 읽은 시점 이후 누군가 이 행을
// 건드렸다면 CAS 가 떨어진다. 필요한 이유: steps[] 를 read-modify-write 하는
// 전이(approve/skip)는 status·current_step 이 **그대로인데 steps 만 바뀐**
// 변경(= 조립 수정 PATCH, A″)을 감지할 수 없고, 그러면 낡은 스냅샷으로
// 새 조립을 덮어써 사용자가 본 체인과 실제로 도는 체인이 갈라진다.
export async function casChain(
  admin: SupabaseClient,
  id: string,
  expected: ChainStatus,
  patch: Partial<
    Pick<
      ChainRow,
      'status' | 'current_step' | 'steps' | 'error_message' | 'template'
    >
  >,
  expectedCurrentStep?: number,
  expectedUpdatedAt?: string,
): Promise<CasResult> {
  let query = admin
    .from(CHAINS_TABLE)
    .update(patch)
    .eq('id', id)
    .eq('status', expected);
  if (expectedCurrentStep !== undefined) {
    query = query.eq('current_step', expectedCurrentStep);
  }
  if (expectedUpdatedAt !== undefined) {
    query = query.eq('updated_at', expectedUpdatedAt);
  }
  const { data, error } = await query.select().maybeSingle();

  if (error) throw error;
  if (!data) return { applied: false, reason: 'conflict' };
  return { applied: true, row: data as ChainRow };
}

// org 스코프로 체인 1건 조회 — 타 org 의 체인을 넘기면 null(정보 누출 방지,
// 라우트가 404 로 응답). admin client 로 읽되 반드시 org_id 로 스코프한다.
export async function getChainForOrg(
  admin: SupabaseClient,
  id: string,
  orgId: string,
): Promise<ChainRow | null> {
  const { data, error } = await admin
    .from(CHAINS_TABLE)
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChainRow | null) ?? null;
}

// ── 사용자 액션 전이 ──────────────────────────────────────────────────────

// 승인 — awaiting_approval → running. 현재 단계를 running 으로 마킹한다.
// 실제 위젯 kick(job 착수)은 호출부(B)가 이 전이 성공 직후 수행한다. 동시
// approve 2회면 CAS 로 1회만 적용 → 두 번째는 conflict(멱등, kick 중복 방지).
export async function approveChain(
  admin: SupabaseClient,
  row: ChainRow,
): Promise<CasResult> {
  if (row.status !== 'awaiting_approval') {
    return { applied: false, reason: 'conflict' };
  }
  const steps = markStep(row.steps, row.current_step, 'running');
  // steps 를 낡은 스냅샷에서 파생하므로 updated_at 토큰까지 술어에 넣는다 —
  // 읽은 뒤 조립 수정(PATCH steps, A″)이 끼어들었으면 승인이 떨어지고(409)
  // 사용자는 갱신된 조립을 다시 승인한다. 구 조립이 조용히 되살아나지 않는다.
  return casChain(
    admin,
    row.id,
    'awaiting_approval',
    { status: 'running', steps },
    row.current_step,
    row.updated_at,
  );
}

// 건너뛰기 — 현재 단계를 skipped 로 두고 다음 단계로 커서 이동. 다음 단계가
// 있으면 approve 모드는 awaiting_approval(다음도 승인 필요), auto 모드는 running
// 으로. 남은 단계가 없으면 체인 done. awaiting_approval 상태에서만 유효.
export async function skipStep(
  admin: SupabaseClient,
  row: ChainRow,
): Promise<CasResult> {
  if (row.status !== 'awaiting_approval') {
    return { applied: false, reason: 'conflict' };
  }
  const steps = markStep(row.steps, row.current_step, 'skipped');
  const nextIndex = row.current_step + 1;
  const hasNext = nextIndex < steps.length;

  if (!hasNext) {
    // approveChain 과 동일한 사유로 updated_at 토큰까지 CAS(steps RMW).
    return casChain(
      admin,
      row.id,
      'awaiting_approval',
      { status: 'done', steps, current_step: row.current_step },
      row.current_step,
      row.updated_at,
    );
  }

  // 다음 단계로 커서 이동. approve 모드면 다음 단계도 승인 게이트(awaiting),
  // auto 면 러너블(running — kick 은 B). 현 PR 에선 approve 가 기본/유일 경로.
  // 체인 status 와 다음 step 의 status 를 동일 값으로 맞춘다(create 라우트가
  // 첫 단계를 세팅하는 방식과 일관 — 활성 단계 = 체인 status 미러).
  // 타입을 'running' | 'awaiting_approval' 로 좁게 추론시킨다(annotation 없이) —
  // ChainStatus·ChainStepStatus 양쪽에 동시 대입 가능해야 markStep + casChain 이
  // 모두 통과한다.
  const nextStatus = row.mode === 'auto' ? 'running' : 'awaiting_approval';
  const steps2 = markStep(steps, nextIndex, nextStatus);
  return casChain(
    admin,
    row.id,
    'awaiting_approval',
    { status: nextStatus, steps: steps2, current_step: nextIndex },
    row.current_step,
    row.updated_at,
  );
}

// 종료 — 활성 상태(running / awaiting_approval / paused) 중 어느 것에서든
// cancelled 로. 현재 status 를 CAS expected 로 써서 경합(동시 cancel+approve)
// 에서도 안전하게 1회만 적용. 이미 종결된 체인이면 conflict(멱등).
export async function cancelChain(
  admin: SupabaseClient,
  row: ChainRow,
): Promise<CasResult> {
  if (!ACTIVE_STATUSES.includes(row.status)) {
    return { applied: false, reason: 'conflict' };
  }
  return casChain(admin, row.id, row.status, {
    status: 'cancelled',
  });
}

// ── 조립 수정 (A″) ───────────────────────────────────────────────────────

// 조립 수정이 허용되는 상태인가 — "체인 row 는 이미 만들어졌지만 **아직
// 아무것도 시작되지 않았다**".
//
// 왜 이 판별이 필요한가: 도킹 레인은 레인이 유효(2단계+ 호환 경로)해지는
// 순간 체인을 POST 한다 — B 의 advance 훅이 진입 위젯 완료 시점에 체인을
// 찾으려면 row 가 세션 완료 전에 존재해야 하기 때문이다. 그래서 "만들어졌지만
// 실행 전" 인 창이 실재하고, 그 창에서 사용자가 카드를 더 붙이거나 떼는 것이
// **정상 사용**이다. 이것을 cancel+재생성으로 처리하면 편집 횟수만큼
// cancelled row 가 쌓여 E 집계(완주율·상태 분포)가 조립 편집 노이즈로
// 오염된다(파일럿 평가 데이터 왜곡). 그래서 row 를 그 자리에서 고친다.
//
// 허용 조건 — 전부 만족해야 한다:
//   1. status='awaiting_approval' — 승인 게이트 **앞**. 이 상태를 고른 것은
//      보수적 선택이다: advance 의 findChainAtStep 은 `status='running'` +
//      현재 단계 `status='running'` 만 매칭하므로, awaiting_approval 체인은
//      advance 가 **구조적으로 손댈 수 없다**. 즉 조립 수정과 체인 전진이
//      애초에 같은 행을 두고 경합하지 않는다.
//      → auto 모드로 생성된 체인(status='running', steps[0]='running')은
//        생성 직후부터 advance 의 채택(adoption) 대상이라 여기서 제외된다.
//        그 경우의 조립 변경은 기존 cancel+재생성 경로로 남는다. auto 는 명시
//        opt-in 이고 기본·파일럿 경로는 approve 이므로, 노이즈 제거 효과는
//        기본 경로에서 온전히 얻는다.
//   2. current_step=0 — 커서가 한 칸도 움직이지 않았다.
//   3. 어느 단계에도 job_ref 가 없다 — 위젯 job 이 하나도 착수되지 않았다.
//   4. steps[0] 은 pending 또는 awaiting_approval, 나머지는 전부 pending —
//      done/skipped/error/running 이 하나라도 있으면 보존해야 할 진행 기록이
//      있다는 뜻이므로 수정 불가.
//
// 4번이 스펙의 "전 단계 pending" 을 그대로 쓰지 않는 이유: 생성 라우트가
// steps[0].status 를 체인 status 의 미러로 세팅하므로(`steps[0] = {...,
// status: chainStatus}`) **전수 pending 인 행은 실제로 존재하지 않는다.**
// 스펙의 의도("running 전 상태")를 지키려면 첫 칸의 승인 대기까지 허용해야
// 한다. pending 도 같이 받는 것은 방어(그 조합이 생기더라도 여전히 미실행).
export function isAssemblyEditable(row: ChainRow): boolean {
  if (row.status !== 'awaiting_approval') return false;
  if (row.current_step !== 0) return false;
  const steps = row.steps ?? [];
  if (steps.length === 0) return false;
  return steps.every((step, i) => {
    if (step.job_ref) return false;
    if (i === 0) {
      return step.status === 'awaiting_approval' || step.status === 'pending';
    }
    return step.status === 'pending';
  });
}

// 조립 교체 — 검증된 새 steps 로 통째 치환한다(멱등 CAS).
//
// CAS 술어 3중: status='awaiting_approval' · current_step=0 · updated_at 토큰.
// 잠금 전이(승인/건너뛰기/종료)나 sweep 이 읽은 뒤 끼어들었으면 전부 떨어진다
// → 라우트가 409 로 돌려주고 사용자는 갱신된 상태를 다시 본다(스펙: 경합 1승).
//
// template='custom' — 자유 조합에서 체인의 정의는 steps 자체이고 template 은
// 관측용 라벨이다. 레거시 템플릿 키로 만들어진 행을 수정하면 더 이상 그 템플릿
// 의 인스턴스가 아니므로 라벨을 사실에 맞춘다(생성 라우트의 자유 조합 경로와
// 동일 값).
//
// updated_at 은 명시적으로 쓰지 않는다 — DB 트리거(widget_chains_updated_at)가
// 모든 update 에서 now() 로 bump 한다. 이게 중요한 이유: chain-sweep 의 STALE
// 판정 기준이 updated_at 이라, 조립을 만지는 동안 체인이 24h 창에 걸려 닫히지
// 않는다. (그리고 그 bump 자체가 위 낙관적 잠금 토큰이 된다.)
export async function replaceChainSteps(
  admin: SupabaseClient,
  row: ChainRow,
  steps: ChainStepInstance[],
): Promise<CasResult> {
  if (!isAssemblyEditable(row)) {
    return { applied: false, reason: 'conflict' };
  }
  return casChain(
    admin,
    row.id,
    'awaiting_approval',
    { steps, current_step: 0, template: 'custom' },
    0,
    row.updated_at,
  );
}

// ── 순수 헬퍼 ────────────────────────────────────────────────────────────

// steps 배열의 index 단계 status 를 교체한 **새 배열**을 반환(불변). index 가
// 범위 밖이면 원본을 그대로 돌려준다(방어).
export function markStep(
  steps: ChainStepInstance[],
  index: number,
  status: ChainStepInstance['status'],
): ChainStepInstance[] {
  if (index < 0 || index >= steps.length) return steps;
  return steps.map((s, i) => (i === index ? { ...s, status } : s));
}
