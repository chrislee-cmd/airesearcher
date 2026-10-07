// ─────────────────────────────────────────────────────────────────────────
// 공유 링크 활성 판정 — 모달 "만료 링크를 활성처럼 되살림" 회귀 가드.
//
// 버그(프로드 실측 2026-09-10): 모달이 revoked_at 만 보고 만료를 무시해, 7월
// 만료 링크를 활성(관리 모드)으로 띄웠다. 활성 = 미폐기 && 미만료. 이 불변식을
// deriveShareStatus/isShareExpired 로 분리(src/lib/share/expiry.ts)했고, 모달·
// /api/share/mine·뷰어 페이지가 공유한다. 세 상태(active/expired/revoked)를
// 전수 고정한다.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveShareStatus, isShareExpired } from '../src/lib/share/expiry.ts';

const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();

describe('isShareExpired', () => {
  it('null(만료 없음) → 만료 아님', () => {
    assert.equal(isShareExpired(null), false);
  });

  it('과거 expires_at → 만료', () => {
    assert.equal(isShareExpired(past()), true);
  });

  it('미래 expires_at → 만료 아님', () => {
    assert.equal(isShareExpired(future()), false);
  });
});

describe('deriveShareStatus — 활성 판정 3분기', () => {
  it('revoked_at 있으면 revoked (만료 여부 무관, revoke 우선)', () => {
    assert.equal(deriveShareStatus(past(), null), 'revoked');
    // revoke + 만료가 겹쳐도 revoked 가 이긴다(최소 노출 순서).
    assert.equal(deriveShareStatus(past(), past()), 'revoked');
  });

  it('미폐기 + 과거 만료 → expired (버그였던 케이스: 활성으로 되살지 않는다)', () => {
    assert.equal(deriveShareStatus(null, past()), 'expired');
  });

  it('미폐기 + 미래 만료 → active', () => {
    assert.equal(deriveShareStatus(null, future()), 'active');
  });

  it('미폐기 + 만료 없음(null) → active', () => {
    assert.equal(deriveShareStatus(null, null), 'active');
  });
});
