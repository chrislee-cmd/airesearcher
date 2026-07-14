// ─────────────────────────────────────────────────────────────────────────
// 70% 순마진 하한 게이트 (D1 가드 · 불변식 CI)
//
// 이 파일은 두 겹의 마진 불변식을 코드로 강제합니다:
//
//   (A) 위젯 크레딧 floor — 모든 위젯에 대해 FEATURE_COSTS[k] ≥ MIN_CREDITS[k].
//       minCredits[widget] = ceil( COGS(₩) / 120 )  (₩500/cr · 수수료 6% · 70% margin).
//
//   (B) 팩 볼륨할인 floor + rail 파리티 (2026-07-14 dual-rail) — 각 팩의 실효
//       per-credit 이 양 rail 모두 70% floor 이상이고, KRW·USD 가격이 **동일한
//       discountPct 사다리에서 파생**됨을 강제(한쪽 rail 만 바뀌면 red).
//
// 공식 SSOT: docs/pricing-scheme.md §3. 상수(FEATURE_COSTS · MIN_CREDITS ·
// CREDIT_BUNDLES)의 실제 값은 src/lib/features.ts 가 SSOT — 이 파일은 검증만.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_COSTS,
  MIN_CREDITS,
  CREDIT_BUNDLES,
  CREDIT_PRICE_LIST_KRW,
  CREDIT_PRICE_LIST_USD,
  MARGIN_FLOOR_KRW_PER_CREDIT,
  MARGIN_FLOOR_USD_PER_CREDIT,
  type FeatureKey,
} from '../src/lib/features.ts';

// ── (A) 위젯 floor ──────────────────────────────────────────────────────────

// 문서화된 floor 예외 화이트리스트 (docs/pricing-scheme.md §4 · §6).
//
// 예외로 지정된 위젯은 위 불변식 검사에서 스킵됩니다. 예외는 오직 하나:
//
//   translate — AI 동시통역. floor 가 실 오디오-분에 종속이라 정적 상수로
//     확정 불가. features.ts 의 MIN_CREDIT_OVERRIDES 에서 0(=미설정 플래그)으로
//     두고, 별도 가드레일 E1(실 오디오-분 과금 + 분당 cr floor)이 마진을
//     보장합니다. 정적 불변식 대상 아님.
//
// (interviews 는 70% 하향으로 floor 가 11 → 9 로 완화돼 cost 10 이 이를 상회 →
//  더 이상 경계 예외가 아니다. 예외 목록에서 빠졌다.)
//
// 여기 없는 위젯이 floor 밑이면 무조건 fail — 예외는 이 상수를 통해서만.
const FLOOR_EXCEPTIONS: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'translate',
]);

type FloorViolation = {
  key: FeatureKey;
  cost: number;
  floor: number;
  shortfall: number;
};

// 순수 게이트 로직 — 실제 상수든 합성 입력이든 동일하게 검사할 수 있게 분리.
// 예외 화이트리스트에 없으면서 cost < floor 인 위젯을 부족분과 함께 반환.
function findFloorViolations(
  costs: Record<string, number>,
  floors: Record<string, number>,
  exceptions: ReadonlySet<string>,
): FloorViolation[] {
  const violations: FloorViolation[] = [];
  for (const key of Object.keys(costs)) {
    if (exceptions.has(key)) continue;
    const cost = costs[key];
    const floor = floors[key] ?? 0;
    if (cost < floor) {
      violations.push({
        key: key as FeatureKey,
        cost,
        floor,
        shortfall: floor - cost,
      });
    }
  }
  return violations;
}

describe('70% 마진 floor 불변식 — FEATURE_COSTS[k] ≥ MIN_CREDITS[k]', () => {
  it('예외를 제외한 모든 위젯이 floor 를 만족한다', () => {
    const violations = findFloorViolations(
      FEATURE_COSTS,
      MIN_CREDITS,
      FLOOR_EXCEPTIONS,
    );

    // 위반 시 위젯명·현재 cost·floor·부족분을 그대로 노출해 원인 위젯을 즉시 식별.
    const report = violations
      .map(
        (v) =>
          `  • ${v.key}: cost=${v.cost}cr < floor=${v.floor}cr (부족 ${v.shortfall}cr) — ` +
          `docs/pricing-scheme.md §3 위반. 가격 상향 또는 문서화된 예외 등록 필요.`,
      )
      .join('\n');

    assert.equal(
      violations.length,
      0,
      `\n70% 순마진 하한 위반 위젯 ${violations.length}개:\n${report}\n`,
    );
  });

  it('floor 예외 위젯은 "예외로 스킵됨" 을 로그하고 검사에서 제외한다', () => {
    for (const key of FLOOR_EXCEPTIONS) {
      // 예외는 실제 FeatureKey 여야 한다 (오타/유령 키 방지).
      assert.ok(
        key in FEATURE_COSTS,
        `floor 예외 "${key}" 가 FEATURE_COSTS 에 없는 유령 키`,
      );
      console.log(
        `[floor-guard] 예외로 스킵됨: ${key} ` +
          `(cost=${FEATURE_COSTS[key]}cr, floor=${MIN_CREDITS[key]}cr) — ` +
          `docs/pricing-scheme.md §6 E1 가드레일`,
      );
    }
  });
});

describe('위젯 floor 게이트 로직 — 인위적 위반 감지', () => {
  it('한 위젯을 floor 밑으로 낮추면 위반으로 잡힌다', () => {
    const costs = { desk: 75, reports: 50, quotes: 25 };
    const floors = { desk: 42, reports: 13, quotes: 25 };

    // desk 를 floor(42) 밑인 40 으로 인위 인하 → 위반 1건.
    const tampered = { ...costs, desk: 40 };
    const violations = findFloorViolations(tampered, floors, new Set<string>());

    assert.equal(violations.length, 1);
    assert.equal(violations[0].key, 'desk');
    assert.equal(violations[0].cost, 40);
    assert.equal(violations[0].floor, 42);
    assert.equal(violations[0].shortfall, 2);
  });

  it('cost === floor(경계 동일)는 위반이 아니다 (≥ 이므로)', () => {
    const violations = findFloorViolations(
      { quotes: 25 },
      { quotes: 25 },
      new Set<string>(),
    );
    assert.equal(violations.length, 0);
  });

  it('예외 화이트리스트에 있으면 floor 밑이어도 스킵된다', () => {
    const violations = findFloorViolations(
      { translate: 40 },
      { translate: 100 },
      new Set<string>(['translate']),
    );
    assert.equal(violations.length, 0);
  });

  it('floor 미설정(undefined→0) 위젯은 어떤 양수 cost 든 통과한다', () => {
    const violations = findFloorViolations(
      { translate: 75 },
      {}, // floor 없음 → 0 으로 취급
      new Set<string>(),
    );
    assert.equal(violations.length, 0);
  });
});

// ── (B) 팩 볼륨할인 floor + rail 파리티 (dual-rail) ──────────────────────────

// KRW 총액을 ₩1,000 단위로 반올림 — features.ts 의 반올림 규약과 동일해야 한다.
function roundThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

describe('팩 볼륨할인 — 70% floor 불변식 (양 rail)', () => {
  it('모든 팩의 실효 per-credit 이 양 rail 모두 70% floor 이상이다', () => {
    const violations: string[] = [];
    for (const b of CREDIT_BUNDLES) {
      if (b.priceKrw != null) {
        const effKrw = b.priceKrw / b.credits;
        if (effKrw < MARGIN_FLOOR_KRW_PER_CREDIT) {
          violations.push(
            `  • ${b.id} KRW: ₩${effKrw.toFixed(1)}/cr < floor ₩${MARGIN_FLOOR_KRW_PER_CREDIT}/cr`,
          );
        }
      }
      if (b.priceUsd != null) {
        const effUsd = b.priceUsd / b.credits;
        if (effUsd < MARGIN_FLOOR_USD_PER_CREDIT) {
          violations.push(
            `  • ${b.id} USD: $${effUsd.toFixed(3)}/cr < floor $${MARGIN_FLOOR_USD_PER_CREDIT}/cr`,
          );
        }
      }
    }
    assert.equal(
      violations.length,
      0,
      `\n70% floor 위반 팩:\n${violations.join('\n')}\n`,
    );
  });

  it('KRW·USD 가격이 동일한 discountPct 사다리에서 파생된다 (rail 파리티)', () => {
    // 한쪽 rail 만 손대면 여기서 red — 두 rail 은 반드시 같이 움직여야 한다.
    for (const b of CREDIT_BUNDLES) {
      const factor = 1 - b.discountPct / 100;

      // USD 는 리스트가에서 정확히 파생 (센트 반올림).
      const expectedUsd =
        Math.round(b.credits * CREDIT_PRICE_LIST_USD * factor * 100) / 100;
      assert.equal(
        b.priceUsd,
        expectedUsd,
        `${b.id}: priceUsd(${b.priceUsd}) ≠ ${b.credits}×$${CREDIT_PRICE_LIST_USD}×${factor} = $${expectedUsd} (discountPct=${b.discountPct} 와 불일치)`,
      );

      // KRW 는 같은 factor 에서 파생 후 ₩1,000 단위 반올림.
      const expectedKrw = roundThousand(
        b.credits * CREDIT_PRICE_LIST_KRW * factor,
      );
      assert.equal(
        b.priceKrw,
        expectedKrw,
        `${b.id}: priceKrw(${b.priceKrw}) ≠ round1000(${b.credits}×₩${CREDIT_PRICE_LIST_KRW}×${factor}) = ₩${expectedKrw} (discountPct=${b.discountPct} 와 불일치)`,
      );
    }
  });

  it('discountPct 사다리는 단조 증가 (mini/starter 0 → max 10)', () => {
    const pcts = CREDIT_BUNDLES.map((b) => b.discountPct);
    for (let i = 1; i < pcts.length; i++) {
      assert.ok(
        pcts[i] >= pcts[i - 1],
        `discountPct 사다리가 감소: ${JSON.stringify(pcts)}`,
      );
    }
    // 스펙 §가격표: mini0 starter0 plus5 pro7.5 max10.
    assert.deepEqual(pcts, [0, 0, 5, 7.5, 10]);
  });

  it('저장된 perCredit 값이 총액/크레딧과 정합 (표시용 drift 방지)', () => {
    for (const b of CREDIT_BUNDLES) {
      if (b.priceKrw != null && b.perCreditKrw != null) {
        assert.equal(
          b.perCreditKrw,
          Math.round(b.priceKrw / b.credits),
          `${b.id}: perCreditKrw 표시값이 priceKrw/credits 와 불일치`,
        );
      }
      if (b.priceUsd != null && b.perCreditUsd != null) {
        // USD 소수 표시 — priceUsd/credits 와 3자리에서 일치.
        assert.equal(
          Number((b.priceUsd / b.credits).toFixed(3)),
          Number(b.perCreditUsd.toFixed(3)),
          `${b.id}: perCreditUsd 표시값이 priceUsd/credits 와 불일치`,
        );
      }
    }
  });
});
