// ─────────────────────────────────────────────────────────────────────────
// 위젯 체인 조립 수정 — 수정가능 판별 불변식 테스트 (A″)
//
// `isAssemblyEditable` 은 "row 는 만들어졌지만 아직 아무것도 시작되지 않았다"
// 를 판별하는 유일한 게이트다. 이 술어가 느슨해지면 진행 기록(job_ref ·
// done/error 마킹)이 있는 체인의 steps 가 통째로 교체돼 조용히 사라진다.
// 반대로 과하게 좁아지면 조립 수정이 전부 409 가 되고, 사용자는 cancel+재생성
// 으로 되돌아가 cancelled row 를 누적시킨다(= 이 PR 이 없애려는 E 집계 왜곡).
// 양쪽 경계를 여기서 고정한다.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAssemblyEditable,
  type ChainRow,
  type ChainStatus,
} from '../src/lib/chains/state.ts';
import type { ChainStepInstance } from '../src/lib/chains/registry.ts';

function step(
  feature: string,
  status: ChainStepInstance['status'],
  job_ref: string | null = null,
): ChainStepInstance {
  return { feature, status, job_ref, cost_at_creation: 0 };
}

// 생성 직후(approve 모드)의 체인 — 생성 라우트가 만드는 실제 shape.
// steps[0] 은 체인 status 의 미러(awaiting_approval), 나머지는 pending.
function chain(
  overrides: Partial<Pick<ChainRow, 'status' | 'current_step' | 'steps'>> = {},
): ChainRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-000000000002',
    project_id: null,
    created_by: '00000000-0000-0000-0000-000000000003',
    mode: 'approve',
    template: 'custom',
    steps: [
      step('probing', 'awaiting_approval'),
      step('transcripts', 'pending'),
    ],
    current_step: 0,
    status: 'awaiting_approval',
    error_message: null,
    created_at: '2026-10-08T00:00:00.000Z',
    updated_at: '2026-10-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('isAssemblyEditable — 허용', () => {
  it('생성 직후 approve 모드 체인(첫 칸 승인 대기 · 나머지 pending)', () => {
    assert.equal(isAssemblyEditable(chain()), true);
  });

  it('첫 칸이 pending 인 조합도 허용(방어 — 여전히 미실행)', () => {
    assert.equal(
      isAssemblyEditable(
        chain({ steps: [step('probing', 'pending'), step('transcripts', 'pending')] }),
      ),
      true,
    );
  });

  it('4단계 전체 조립', () => {
    assert.equal(
      isAssemblyEditable(
        chain({
          steps: [
            step('probing', 'awaiting_approval'),
            step('transcripts', 'pending'),
            step('interview_ingest', 'pending'),
            step('topline', 'pending'),
          ],
        }),
      ),
      true,
    );
  });
});

describe('isAssemblyEditable — 잠금', () => {
  it('승인되어 실행 중(status running)', () => {
    assert.equal(
      isAssemblyEditable(
        chain({
          status: 'running',
          steps: [step('probing', 'running'), step('transcripts', 'pending')],
        }),
      ),
      false,
    );
  });

  it('auto 모드 생성 직후 — advance 채택 대상이라 제외(보수적 선택)', () => {
    const row = chain({
      status: 'running',
      steps: [step('probing', 'running'), step('transcripts', 'pending')],
    });
    assert.equal(isAssemblyEditable({ ...row, mode: 'auto' }), false);
  });

  it('커서가 이미 전진', () => {
    assert.equal(
      isAssemblyEditable(
        chain({
          current_step: 1,
          steps: [step('probing', 'done'), step('transcripts', 'awaiting_approval')],
        }),
      ),
      false,
    );
  });

  it('첫 단계에 job_ref 가 붙었다(위젯 job 착수됨)', () => {
    assert.equal(
      isAssemblyEditable(
        chain({
          steps: [
            step('probing', 'awaiting_approval', 'job-1'),
            step('transcripts', 'pending'),
          ],
        }),
      ),
      false,
    );
  });

  it('뒤쪽 단계에 진행 기록이 있다', () => {
    for (const s of ['done', 'skipped', 'error', 'running'] as const) {
      assert.equal(
        isAssemblyEditable(
          chain({
            steps: [step('probing', 'awaiting_approval'), step('transcripts', s)],
          }),
        ),
        false,
        `steps[1].status=${s} 는 잠금이어야 한다`,
      );
    }
  });

  it('종결 상태 체인(done/error/cancelled/잔액정지) — 재실행은 새 POST 의 몫', () => {
    const locked: ChainStatus[] = [
      'done',
      'error',
      'cancelled',
      'paused_insufficient_credits',
    ];
    for (const status of locked) {
      assert.equal(
        isAssemblyEditable(chain({ status })),
        false,
        `status=${status} 는 잠금이어야 한다`,
      );
    }
  });

  it('steps 가 비었다(방어)', () => {
    assert.equal(isAssemblyEditable(chain({ steps: [] })), false);
  });
});
