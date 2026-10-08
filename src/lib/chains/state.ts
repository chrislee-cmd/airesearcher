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

// ── 조립 완료·미실행 판별 (A″ 수정 게이트 + B′ 채택 게이트 공용) ─────────

// "체인 row 는 이미 만들어졌지만 **아직 아무것도 시작되지 않았다**".
//
// 왜 이 판별이 필요한가: 도킹 레인은 레인이 유효(2단계+ 호환 경로)해지는
// 순간 체인을 POST 한다 — B 의 advance 훅이 진입 위젯 완료 시점에 체인을
// 찾으려면 row 가 세션 완료 전에 존재해야 하기 때문이다. 그래서 "만들어졌지만
// 실행 전" 인 창이 실재한다. 그 창에서 사용자가 하는 일은 두 가지뿐이고,
// **두 소비자가 이 술어 하나를 공유한다**:
//   - 카드를 더 붙이거나 뗀다 → A″ 조립 수정(PATCH steps). cancel+재생성으로
//     처리하면 편집 횟수만큼 cancelled row 가 쌓여 E 집계(완주율·상태 분포)가
//     조립 편집 노이즈로 오염된다(파일럿 평가 데이터 왜곡) → row 를 그 자리에서 고친다.
//   - 진입 위젯 세션을 그냥 돌려서 끝낸다 → B′ 채택(advance). 이 체인을
//     채택하지 않으면 "세션이 끝나면 시작"(CD L3→L4)이 성립하지 않는다.
//
// 조건 — 전부 만족해야 한다:
//   1. status='awaiting_approval' — 승인 게이트 **앞**.
//      → auto 모드로 생성된 체인(status='running', steps[0]='running')은
//        여기 걸리지 않는다. auto 는 생성 직후부터 advance 의 running-채택
//        대상이고, 그 구간은 status·current_step 이 둘 다 무변이라 CAS 로
//        선후를 가를 수 없다(학습기록 §3) — 그래서 조립 수정에서도 제외된다.
//   2. current_step=0 — 커서가 한 칸도 움직이지 않았다.
//   3. 어느 단계에도 job_ref 가 없다 — 위젯 job 이 하나도 착수되지 않았다.
//   4. steps[0] 은 pending 또는 awaiting_approval, 나머지는 전부 pending —
//      done/skipped/error/running 이 하나라도 있으면 보존해야 할 진행 기록이
//      있다는 뜻이므로 수정도 채택도 불가.
//
// 4번이 "전 단계 pending" 이 아닌 이유: 생성 라우트가 steps[0].status 를 체인
// status 의 미러로 세팅하므로(`steps[0] = {..., status: chainStatus}`) **전수
// pending 인 행은 실제로 존재하지 않는다.** "running 전 상태" 를 지키려면 첫
// 칸의 승인 대기까지 허용해야 한다. pending 도 같이 받는 것은 방어(그 조합이
// 생기더라도 여전히 미실행).
export function isUnstartedAssembly(row: ChainRow): boolean {
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

// 조립 수정(PATCH steps, A″)이 허용되는가 — 위 술어와 **같은 창**이다.
//
// ⚠️ 2026-10-08(B′) 정정: 이 조건 1의 원래 근거는 "advance 는 awaiting_approval
// 체인을 구조적으로 손댈 수 없으니 수정과 전진이 애초에 경합하지 않는다" 였다.
// B′ 가 그 전제를 바꿨다 — advance 가 이제 **바로 이 창의 체인을 채택**한다
// (조립만 해 두고 진입 위젯을 그냥 돌린 사용자를 전진시키려면 필수).
// 그래도 수정 API 는 그대로 안전하다: 채택은 `status`(+커서)를 바꾸는 전이이고
// 양쪽 CAS 가 **같은 updated_at 토큰**을 술어로 들고 있어 선후가 결정된다 —
// PATCH 가 먼저면 채택 CAS 가 떨어져 no-op, 채택이 먼저면 PATCH 가 409.
// 조용히 덮어쓰는 경로는 양방향 모두 없다. (auto 채택 구간과의 차이가 여기다:
// 거기는 status 무변이라 토큰만으로 못 가른다 — 학습기록 §3.)
export function isAssemblyEditable(row: ChainRow): boolean {
  return isUnstartedAssembly(row);
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

// ── 단계 완료 이벤트 매칭 · 전진 계획 (B′) ────────────────────────────────
//
// advance 훅의 **순수 부분**을 여기 둔다 — 후보 행 집합에서 어느 체인을
// 고를지(pickChainForStepEvent)와 그 체인을 어떻게 전진시킬지(planStepAdvance).
// advance.ts 는 server-only(env · supabase admin · fetch)를 import 하므로
// `tests/` 로더가 해석하지 못한다(학습기록 §4). 판정·계획을 이 모듈로 내려
// 두면 매칭 경계와 CAS 술어를 단위 테스트로 고정할 수 있다.

// 이번 완료 이벤트(단계 done 훅)의 식별 정보.
export type ChainStepEvent = {
  // 체인 project_id 와 교차 검증할 스코프. 양쪽이 다 있고 서로 다르면 다른 체인.
  projectId?: string | null;
  // 방금 완료된 단계의 레지스트리 key.
  sourceFeature: string;
  // 완료된 위젯 job id(전사 job / 프로빙 세션 / 인터뷰 job).
  jobRef: string;
};

// 매칭 결과. kind 는 어느 경로로 걸렸는지 — 관측·테스트용.
//   exact          — 현재 단계 job_ref 가 이번 jobRef. 체인이 직접 kick 한 단계.
//   adopt_running  — running 체인의 현재 단계가 미실행(job_ref 없음). 가변
//                    진입점으로 시작한 첫 단계 / auto 모드 생성 직후.
//   adopt_assembly — **B′**: 조립만 끝내고 아직 아무것도 시작하지 않은
//                    approve 체인(awaiting_approval · 커서 0 · job_ref 전무).
export type ChainMatchKind = 'exact' | 'adopt_running' | 'adopt_assembly';

export type ChainStepEventMatch =
  | { matched: true; kind: ChainMatchKind; row: ChainRow }
  | { matched: false; reason: 'none' | 'ambiguous' };

// 체인 project_id 가 null(프로빙 진입 직후 미귀속)이면 스코프로 가르지 않는다.
function scopeMatches(row: ChainRow, ev: ChainStepEvent): boolean {
  if (!ev.projectId || !row.project_id) return true;
  return row.project_id === ev.projectId;
}

/**
 * 이 완료 이벤트가 전진시켜야 할 체인을 고른다. 후보는 **우선순위 풀**로
 * 본다 — 먼저 걸린 풀에서 끝내고, 그 풀 안에서 2개 이상이면 ambiguous
 * (추측해서 엉뚱한 체인을 전진시키는 것보다 아무것도 안 하는 게 안전하다).
 *
 *   1. exact — running 체인의 현재 단계 job_ref === 이번 jobRef.
 *   2. adopt_running — running 체인의 현재 단계가 미실행.
 *   3. adopt_assembly — 조립 완료·미실행 approve 체인(B′).
 *
 * **풀 순서가 회귀 방어다.** 2·3 을 한 풀에 합치면, 같은 org 에 살아 있는
 * 조립 체인 하나가 기존 running 채택을 ambiguous 로 끌어내려 **지금까지
 * 전진했던 경로를 no-op 으로 만든다.** running 체인은 이미 라이브 오케스트
 * 레이션이라 이 이벤트에 대한 권리가 더 강하고, 조립 체인은 아직 pre-start
 * 다 — 그래서 running 을 먼저 소진한다.
 */
export function pickChainForStepEvent(
  rows: ChainRow[],
  ev: ChainStepEvent,
): ChainStepEventMatch {
  // running 풀 — 체인 status='running' **그리고** 현재 단계 status='running'.
  // (approve 모드에서 아직 승인되지 않은 단계는 'awaiting_approval' 이라 여기
  //  안 걸린다 — 사용자가 승인하지 않은 작업을 체인 진행으로 오인하지 않기
  //  위한 가드. 그 체인의 "조립 완료" 경우만 아래 3번이 따로 받는다.)
  const running = rows.filter((r) => {
    if (r.status !== 'running') return false;
    const step = r.steps?.[r.current_step];
    return step?.feature === ev.sourceFeature && step.status === 'running';
  });

  const exact = running.filter(
    (r) => r.steps[r.current_step].job_ref === ev.jobRef,
  );
  if (exact.length > 0) return { matched: true, kind: 'exact', row: exact[0] };

  const adoptRunning = running.filter(
    (r) => !r.steps[r.current_step].job_ref && scopeMatches(r, ev),
  );
  if (adoptRunning.length === 1) {
    return { matched: true, kind: 'adopt_running', row: adoptRunning[0] };
  }
  if (adoptRunning.length > 1) return { matched: false, reason: 'ambiguous' };

  // 조립 풀(B′) — isUnstartedAssembly 가 커서 0 · steps 비어있지 않음 ·
  // job_ref 전무 · 진행 마킹 전무를 보장하므로 steps[0] 접근이 안전하다.
  // 완료된 feature 가 **진입 단계(steps[0])** 와 일치해야 한다 — 뒤쪽 칸의
  // feature 가 우연히 맞는 체인을 채택하면 커서를 건너뛰어 전진시키게 된다.
  const assembly = rows.filter(
    (r) =>
      isUnstartedAssembly(r) &&
      r.steps[0].feature === ev.sourceFeature &&
      scopeMatches(r, ev),
  );
  if (assembly.length === 1) {
    return { matched: true, kind: 'adopt_assembly', row: assembly[0] };
  }
  if (assembly.length > 1) return { matched: false, reason: 'ambiguous' };

  return { matched: false, reason: 'none' };
}

// 한 번의 전진에 필요한 CAS 술어 + patch. 호출부(advance)는 이것을 그대로
// casChain 에 넘기기만 한다.
export type ChainAdvancePlan = {
  expectedStatus: ChainStatus;
  expectedCurrentStep: number;
  // 조립 채택(B′)에서만 채워진다 — 아래 planStepAdvance 주석 참고.
  expectedUpdatedAt?: string;
  patch: Pick<ChainRow, 'status' | 'steps'> & { current_step?: number };
  // 전진 후 커서. null = 마지막 단계였다(체인 종결).
  nextIndex: number | null;
  // 전진 후 활성 단계 status(= 체인 status 미러). null = 종결.
  nextStatus: 'running' | 'awaiting_approval' | null;
};

/**
 * 현재 단계 done 을 반영하고 한 칸 전진시키는 계획을 세운다(순수).
 *
 * **"활성 단계 = 체인 status 미러" 불변 규칙**(학습기록 §1)을 여기서 지킨다 —
 * 다음 단계의 step status 와 체인 status 를 같은 값으로 세팅한다(생성 라우트·
 * skipStep 과 동일 규칙).
 *
 * **CAS 술어 선택 — expectedStatus 는 읽은 그 상태다.**
 *   - running 체인: expected='running'. 커서까지 술어에 넣어 동시 done 이벤트
 *     (webhook+poll)가 커서를 두 칸 밀지 못하게 한다(R1).
 *   - 조립 체인(B′): expected='awaiting_approval' + **updated_at 낙관적 토큰**.
 *     이 전이는 status 와 커서를 둘 다 바꾸므로 조립 수정 PATCH 와의 선후가
 *     CAS 로 **결정된다** — PATCH 가 먼저면 트리거가 updated_at 을 bump 해
 *     채택이 0 행 매칭으로 떨어지고(no-op; 사용자가 갱신된 조립으로 다시
 *     세션을 돌리는 게 정상 경로), 채택이 먼저면 PATCH 쪽 3중 CAS(status ·
 *     current_step=0 · 토큰)가 떨어져 409 가 된다. 양방향 1승.
 *
 * running 경로에 토큰을 쓰지 않는 이유: advance 자신이 어댑터의 best-effort
 * patchStep(job_ref/error 기록)으로 같은 행의 updated_at 을 bump 하는 경로가
 * 있어, 토큰을 넣으면 정상 전진이 자기 자신 때문에 떨어진다(학습기록 §3).
 */
export function planStepAdvance(
  chain: ChainRow,
  jobRef: string,
): ChainAdvancePlan {
  const doneIndex = chain.current_step;
  // 완료 단계 마킹 + job_ref 채택(사용자가 직접 돌린 진입 단계는 여기서 처음
  // 채워진다). 어댑터가 남긴 error 는 성공으로 덮는다(단계가 실제로 완료됐다).
  const markedDone: ChainStepInstance[] = chain.steps.map((s, i) =>
    i === doneIndex
      ? { ...s, status: 'done', job_ref: s.job_ref ?? jobRef, error: null }
      : s,
  );

  // 조립 채택만 낙관적 토큰을 쓴다(위 주석).
  const expectedUpdatedAt =
    chain.status === 'awaiting_approval' ? chain.updated_at : undefined;

  const nextIndex = doneIndex + 1;
  if (nextIndex >= markedDone.length) {
    // 마지막 단계 완료 → 체인 종결.
    return {
      expectedStatus: chain.status,
      expectedCurrentStep: doneIndex,
      expectedUpdatedAt,
      patch: { status: 'done', steps: markedDone },
      nextIndex: null,
      nextStatus: null,
    };
  }

  // approve 모드는 승인 게이트(awaiting_approval)까지만 — 실제 kick 은 사용자가
  // 승인 모달에서 누를 때 approve 라우트가 한다(크레딧 사전 고지 = #1024 의
  // 해독제). auto 모드는 바로 러너블(running)이고 호출부가 kick 한다.
  //
  // 조립 채택(B′)의 결과도 이 분기를 그대로 탄다: 체인은 pre-start 창에서
  // 빠져나와 커서 1 의 **진짜 승인 게이트**(approve) 또는 running+kick(auto)로
  // 간다. 진입 단계를 사용자가 직접 돌린 것이 그 단계의 승인을 대신하고,
  // 다음 단계는 모드가 정한 게이트를 그대로 받는다 — 승인 모드의 약속(매 단계
  // 비용 고지)을 채택이 건너뛰지 않는다.
  // 타입을 'running' | 'awaiting_approval' 로 좁게 추론시킨다(annotation 없이) —
  // ChainStatus·ChainStepStatus 양쪽에 동시 대입 가능해야 markStep + casChain 이
  // 모두 통과한다(skipStep 과 동일 패턴).
  const nextStatus = chain.mode === 'auto' ? 'running' : 'awaiting_approval';
  const steps = markStep(markedDone, nextIndex, nextStatus);
  return {
    expectedStatus: chain.status,
    expectedCurrentStep: doneIndex,
    expectedUpdatedAt,
    patch: { status: nextStatus, steps, current_step: nextIndex },
    nextIndex,
    nextStatus,
  };
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
