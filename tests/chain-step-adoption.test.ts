// ─────────────────────────────────────────────────────────────────────────
// 위젯 체인 — 단계 완료 이벤트 매칭 + 전진 계획 (B′)
//
// 메우는 틈: `findChainAtStep` 이 `status='running'` 만 후보로 뽑았기 때문에,
// 기본 모드(approve)로 **조립만 끝낸** 체인(awaiting_approval · 커서 0 ·
// job_ref 전무)은 사용자가 진입 위젯 세션을 실제로 끝내도 전진하지 않았다
// (CD L3→L4 "세션이 끝나면 시작" 불성립 — D-v3 conformance 가 발견).
//
// 이 파일이 고정하는 것 두 가지:
//   1. 매칭 경계 — 어떤 체인을 채택하고 어떤 체인은 건드리지 않는가. 느슨해
//      지면 엉뚱한 체인이 전진하고, 좁아지면 틈이 그대로 남는다. 특히
//      **풀 우선순위**(running 먼저) — 조립 체인이 기존 running 채택을
//      ambiguous 로 끌어내리면 지금까지 돌던 경로가 no-op 회귀한다.
//   2. CAS 술어 — 조립 채택만 `updated_at` 낙관적 토큰을 들고 간다. 이것이
//      조립 수정 PATCH 와의 선후를 가르는 유일한 장치다(학습기록 §2·§3).
//
// advance.ts 자체는 server-only(env · supabase admin · fetch)를 import 해
// `tests/` 로더가 해석하지 못한다(학습기록 §4) — 그래서 순수 판정·계획을
// state.ts 로 내리고 여기서 테스트한다.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickChainForStepEvent,
  planStepAdvance,
  type ChainRow,
} from '../src/lib/chains/state.ts';
import type { ChainStepInstance } from '../src/lib/chains/registry.ts';

const UPDATED_AT = '2026-10-08T00:00:00.000Z';

function step(
  feature: string,
  status: ChainStepInstance['status'],
  job_ref: string | null = null,
): ChainStepInstance {
  return { feature, status, job_ref, cost_at_creation: 0 };
}

function chain(
  id: string,
  overrides: Partial<ChainRow> = {},
): ChainRow {
  return {
    id,
    org_id: 'org-1',
    project_id: null,
    created_by: 'user-1',
    mode: 'approve',
    template: 'custom',
    steps: [
      step('probing', 'awaiting_approval'),
      step('transcripts', 'pending'),
    ],
    current_step: 0,
    status: 'awaiting_approval',
    error_message: null,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

// 생성 라우트가 만드는 실제 shape — approve 모드 조립 완료 체인(미실행).
function assemblyChain(id = 'c-assembly', overrides: Partial<ChainRow> = {}) {
  return chain(id, overrides);
}

// 승인되어 도는 체인 — 현재 단계 running + job_ref.
function runningChain(id = 'c-running', jobRef: string | null = 'job-1') {
  return chain(id, {
    status: 'running',
    steps: [step('probing', 'running', jobRef), step('transcripts', 'pending')],
  });
}

const EVENT = { sourceFeature: 'probing', jobRef: 'job-9' } as const;

describe('pickChainForStepEvent — 조립 완료 체인 채택 (B′)', () => {
  it('approve 조립 체인(awaiting · 커서 0 · job_ref 전무) 을 채택한다', () => {
    const row = assemblyChain();
    const m = pickChainForStepEvent([row], EVENT);
    assert.equal(m.matched, true);
    assert.equal(m.matched && m.kind, 'adopt_assembly');
    assert.equal(m.matched && m.row.id, row.id);
  });

  it('진입 단계 feature 가 다르면 채택하지 않는다', () => {
    const m = pickChainForStepEvent([assemblyChain()], {
      ...EVENT,
      sourceFeature: 'transcripts',
    });
    assert.equal(m.matched, false);
    assert.equal(!m.matched && m.reason, 'none');
  });

  it('뒤쪽 칸에 같은 feature 가 있어도 채택하지 않는다(커서 건너뛰기 금지)', () => {
    const row = assemblyChain('c-x', {
      steps: [
        step('transcripts', 'awaiting_approval'),
        step('interview_ingest', 'pending'),
      ],
    });
    const m = pickChainForStepEvent([row], EVENT);
    assert.equal(m.matched, false);
  });

  it('커서가 전진한 awaiting 체인(진짜 승인 대기)은 채택하지 않는다', () => {
    const row = chain('c-mid', {
      current_step: 1,
      steps: [step('probing', 'done', 'job-0'), step('transcripts', 'awaiting_approval')],
    });
    assert.equal(pickChainForStepEvent([row], EVENT).matched, false);
  });

  it('어디든 job_ref 가 붙은 awaiting 체인은 채택하지 않는다(실행 기록 보존)', () => {
    const row = assemblyChain('c-jr', {
      steps: [
        step('probing', 'awaiting_approval', 'job-0'),
        step('transcripts', 'pending'),
      ],
    });
    assert.equal(pickChainForStepEvent([row], EVENT).matched, false);
  });

  it('뒤쪽 칸에 진행 마킹이 있으면 채택하지 않는다', () => {
    for (const s of ['done', 'skipped', 'error', 'running'] as const) {
      const row = assemblyChain(`c-${s}`, {
        steps: [step('probing', 'awaiting_approval'), step('transcripts', s)],
      });
      assert.equal(
        pickChainForStepEvent([row], EVENT).matched,
        false,
        `steps[1].status=${s} 는 채택 대상이 아니어야 한다`,
      );
    }
  });

  it('프로젝트 스코프가 서로 다르면 채택하지 않는다', () => {
    const row = assemblyChain('c-p', { project_id: 'proj-A' });
    assert.equal(
      pickChainForStepEvent([row], { ...EVENT, projectId: 'proj-B' }).matched,
      false,
    );
    // 체인 project_id 가 null(프로빙 진입 직후 미귀속)이면 스코프로 가르지 않는다.
    assert.equal(
      pickChainForStepEvent([assemblyChain()], { ...EVENT, projectId: 'proj-B' })
        .matched,
      true,
    );
  });

  it('조립 체인이 2개면 ambiguous — 추측 금지', () => {
    const m = pickChainForStepEvent(
      [assemblyChain('c-1'), assemblyChain('c-2')],
      EVENT,
    );
    assert.equal(m.matched, false);
    assert.equal(!m.matched && m.reason, 'ambiguous');
  });

  it('체인이 없으면 no-op (#1024 불변식)', () => {
    const m = pickChainForStepEvent([], EVENT);
    assert.equal(m.matched, false);
    assert.equal(!m.matched && m.reason, 'none');
  });
});

describe('pickChainForStepEvent — 기존 경로 회귀 0', () => {
  it('exact — 현재 단계 job_ref 가 이번 jobRef', () => {
    const row = runningChain('c-exact', EVENT.jobRef);
    const m = pickChainForStepEvent([row], EVENT);
    assert.equal(m.matched && m.kind, 'exact');
    assert.equal(m.matched && m.row.id, 'c-exact');
  });

  it('adopt_running — running 체인의 현재 단계가 미실행(job_ref 없음)', () => {
    const m = pickChainForStepEvent([runningChain('c-ar', null)], EVENT);
    assert.equal(m.matched && m.kind, 'adopt_running');
  });

  it('running 풀이 조립 풀보다 먼저다 — 조립 체인 때문에 ambiguous 로 떨어지지 않는다', () => {
    const m = pickChainForStepEvent(
      [assemblyChain('c-assembly'), runningChain('c-ar', null)],
      EVENT,
    );
    assert.equal(m.matched && m.kind, 'adopt_running');
    assert.equal(m.matched && m.row.id, 'c-ar');
  });

  it('running 풀이 2개면 여전히 ambiguous', () => {
    const m = pickChainForStepEvent(
      [runningChain('c-a', null), runningChain('c-b', null)],
      EVENT,
    );
    assert.equal(!m.matched && m.reason, 'ambiguous');
  });

  it('현재 단계가 awaiting 인 running 체인은 안 걸린다(미승인 작업 오인 금지)', () => {
    const row = chain('c-na', {
      status: 'running',
      current_step: 1,
      steps: [step('probing', 'done', 'job-0'), step('probing', 'awaiting_approval')],
    });
    assert.equal(pickChainForStepEvent([row], EVENT).matched, false);
  });

  it('종결 체인(done/error/cancelled/잔액정지)은 후보가 아니다', () => {
    for (const status of ['done', 'error', 'cancelled', 'paused_insufficient_credits'] as const) {
      const row = chain(`c-${status}`, { status });
      assert.equal(
        pickChainForStepEvent([row], EVENT).matched,
        false,
        `status=${status}`,
      );
    }
  });
});

describe('planStepAdvance — CAS 술어 (경합 판별)', () => {
  it('조립 채택: expected=awaiting_approval + updated_at 토큰 → PATCH 가 먼저면 패배', () => {
    const row = assemblyChain();
    const plan = planStepAdvance(row, EVENT.jobRef);
    assert.equal(plan.expectedStatus, 'awaiting_approval');
    assert.equal(plan.expectedCurrentStep, 0);
    // 토큰이 술어에 있으므로, PATCH 가 먼저 성공해 트리거가 updated_at 을
    // bump 하면 이 CAS 는 0 행 매칭 → no-op.
    assert.equal(plan.expectedUpdatedAt, UPDATED_AT);
  });

  it('running 경로는 토큰을 쓰지 않는다(어댑터 patchStep 이 스스로 bump — 학습기록 §3)', () => {
    const plan = planStepAdvance(runningChain('c-r', null), EVENT.jobRef);
    assert.equal(plan.expectedStatus, 'running');
    assert.equal(plan.expectedUpdatedAt, undefined);
    assert.equal(plan.expectedCurrentStep, 0);
  });
});

describe('planStepAdvance — 전이 결과 (활성 단계 = 체인 status 미러)', () => {
  it('조립 채택 + approve: 커서 1 로 전진, 다음 단계는 진짜 승인 게이트', () => {
    const plan = planStepAdvance(assemblyChain(), EVENT.jobRef);
    assert.equal(plan.nextIndex, 1);
    assert.equal(plan.nextStatus, 'awaiting_approval');
    assert.equal(plan.patch.current_step, 1);
    // 체인 status 와 활성 단계 status 가 같은 값(미러 규칙).
    assert.equal(plan.patch.status, 'awaiting_approval');
    assert.equal(plan.patch.steps[1].status, 'awaiting_approval');
    // 완료 단계는 done + 이번 jobRef 채택(진입 단계는 여기서 처음 채워진다).
    assert.equal(plan.patch.steps[0].status, 'done');
    assert.equal(plan.patch.steps[0].job_ref, EVENT.jobRef);
    assert.equal(plan.patch.steps[0].error, null);
  });

  it('채택 결과는 더 이상 조립 수정 대상이 아니다 → 뒤늦은 PATCH 는 409', async () => {
    const { isAssemblyEditable } = await import('../src/lib/chains/state.ts');
    const row = assemblyChain();
    assert.equal(isAssemblyEditable(row), true);
    const plan = planStepAdvance(row, EVENT.jobRef);
    const after: ChainRow = {
      ...row,
      status: plan.patch.status,
      steps: plan.patch.steps,
      current_step: plan.patch.current_step ?? row.current_step,
    };
    assert.equal(isAssemblyEditable(after), false);
  });

  it('기존 job_ref 가 있으면 보존한다(덮어쓰지 않음)', () => {
    const plan = planStepAdvance(runningChain('c-r', 'job-1'), EVENT.jobRef);
    assert.equal(plan.patch.steps[0].job_ref, 'job-1');
  });

  it('auto 모드: 다음 단계 running → 호출부가 kick', () => {
    const row = chain('c-auto', {
      mode: 'auto',
      status: 'running',
      steps: [step('probing', 'running'), step('transcripts', 'pending')],
    });
    const plan = planStepAdvance(row, EVENT.jobRef);
    assert.equal(plan.nextStatus, 'running');
    assert.equal(plan.patch.status, 'running');
    assert.equal(plan.patch.steps[1].status, 'running');
  });

  it('마지막 단계 완료 → 체인 종결(커서 이동 없음)', () => {
    const row = chain('c-last', {
      current_step: 1,
      status: 'running',
      steps: [step('probing', 'done', 'job-0'), step('transcripts', 'running')],
    });
    const plan = planStepAdvance(row, EVENT.jobRef);
    assert.equal(plan.nextIndex, null);
    assert.equal(plan.nextStatus, null);
    assert.equal(plan.patch.status, 'done');
    assert.equal(plan.patch.current_step, undefined);
  });

  it('단일 단계 조립 체인도 채택 즉시 종결된다', () => {
    const row = assemblyChain('c-solo', { steps: [step('probing', 'awaiting_approval')] });
    const plan = planStepAdvance(row, EVENT.jobRef);
    assert.equal(plan.expectedStatus, 'awaiting_approval');
    assert.equal(plan.expectedUpdatedAt, UPDATED_AT);
    assert.equal(plan.patch.status, 'done');
    assert.equal(plan.patch.steps[0].job_ref, EVENT.jobRef);
  });
});
