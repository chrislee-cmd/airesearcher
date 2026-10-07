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
export async function casChain(
  admin: SupabaseClient,
  id: string,
  expected: ChainStatus,
  patch: Partial<
    Pick<ChainRow, 'status' | 'current_step' | 'steps' | 'error_message'>
  >,
): Promise<CasResult> {
  const { data, error } = await admin
    .from(CHAINS_TABLE)
    .update(patch)
    .eq('id', id)
    .eq('status', expected)
    .select()
    .maybeSingle();

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
  return casChain(admin, row.id, 'awaiting_approval', {
    status: 'running',
    steps,
  });
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
    return casChain(admin, row.id, 'awaiting_approval', {
      status: 'done',
      steps,
      current_step: row.current_step,
    });
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
  return casChain(admin, row.id, 'awaiting_approval', {
    status: nextStatus,
    steps: steps2,
    current_step: nextIndex,
  });
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
