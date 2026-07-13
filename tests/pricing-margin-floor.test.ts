// ─────────────────────────────────────────────────────────────────────────
// 75% 순마진 하한 게이트 (D1 가드 · 불변식 CI)
//
// 이 파일이 "위젯 크레딧 ≥ min-cr" 마진 하한을 코드로 강제하는 게이트입니다.
// 공식 SSOT: docs/pricing-scheme.md §3.2 "D1 가드" —
//   minCredits[widget] = ceil( COGS(₩) / 95 )   (₩500/cr · 결제수수료 6% · 순마진 75%)
//   불변식: 모든 위젯에 대해  FEATURE_COSTS[k] ≥ MIN_CREDITS[k]
//
// 향후 누군가 실수로 위젯 크레딧 가격을 floor 아래로 내리면 이 테스트가 fail →
// CI(`pnpm test`)가 머지를 차단합니다. 상수(FEATURE_COSTS · MIN_CREDITS)의
// 실제 값은 src/lib/features.ts 가 SSOT — 이 파일은 그 값을 검증만 합니다.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_COSTS,
  MIN_CREDITS,
  type FeatureKey,
} from '../src/lib/features.ts';

// 문서화된 floor 예외 화이트리스트 (docs/pricing-scheme.md §4 · §6).
//
// 예외로 지정된 위젯은 위 불변식 검사에서 스킵됩니다. 예외는 오직 아래 두 개:
//
//   translate — AI 동시통역. floor 가 실 오디오-분에 종속이라 정적 상수로
//     확정 불가. features.ts 의 MIN_CREDIT_OVERRIDES 에서 0(=미설정 플래그)으로
//     두고, 별도 가드레일 E1(실 오디오-분 과금 + 분당 cr floor)이 마진을
//     보장합니다. 정적 불변식 대상 아님.
//
//   interviews — COGS ≈ ₩1,000 추정 → ⌈1000/95⌉ = 11cr 이 이론 floor 이지만
//     현행 가격은 10cr(경계 예외). features.ts override 가 11 을 박아 두어
//     정적 불변식으로는 위반이므로, COGS ≤ ₩950 확인 전까지 문서화된 경계
//     예외로 스킵합니다 (docs/pricing-scheme.md §4 표의 ⚠️ 행).
//
// 여기 없는 위젯이 floor 밑이면 무조건 fail — 예외는 이 상수를 통해서만.
const FLOOR_EXCEPTIONS: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'translate',
  'interviews',
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

describe('75% 마진 floor 불변식 — FEATURE_COSTS[k] ≥ MIN_CREDITS[k]', () => {
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
      `\n75% 순마진 하한 위반 위젯 ${violations.length}개:\n${report}\n`,
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
          `docs/pricing-scheme.md ${key === 'translate' ? '§6 E1 가드레일' : '§4 경계 예외'}`,
      );
    }
  });

  it('예외로 지정된 위젯은 실제로 예외가 필요한 경계(=정적 불변식 위반)여야 한다', () => {
    // 화이트리스트가 무의미하게 부풀지 않도록: 예외 위젯은 정말로 정적
    // 불변식을 (예외가 없었다면) 위반하는 것들이어야 한다.
    //   interviews: cost 10 < floor 11 → 위반 → 예외 정당.
    //   translate:  floor 0(=미설정) → cost 75 ≥ 0 은 형식상 통과하지만,
    //               실 오디오-분 종속이라 정적 검사 대상에서 의도적으로 제외.
    const withoutExceptions = findFloorViolations(
      FEATURE_COSTS,
      MIN_CREDITS,
      new Set<string>(),
    );
    const violatingKeys = new Set(withoutExceptions.map((v) => v.key));

    // interviews 는 예외가 없으면 실제로 잡혀야 한다 (가드에 이빨이 있음을 증명).
    assert.ok(
      violatingKeys.has('interviews'),
      'interviews 가 정적 불변식을 위반하지 않는다면 예외 화이트리스트에서 빼야 함',
    );
  });
});

describe('floor 게이트 로직 — 인위적 위반 감지', () => {
  it('한 위젯을 floor 밑으로 낮추면 위반으로 잡힌다', () => {
    const costs = { desk: 75, reports: 50, quotes: 25 };
    const floors = { desk: 53, reports: 16, quotes: 25 };

    // desk 를 floor(53) 밑인 40 으로 인위 인하 → 위반 1건.
    const tampered = { ...costs, desk: 40 };
    const violations = findFloorViolations(tampered, floors, new Set<string>());

    assert.equal(violations.length, 1);
    assert.equal(violations[0].key, 'desk');
    assert.equal(violations[0].cost, 40);
    assert.equal(violations[0].floor, 53);
    assert.equal(violations[0].shortfall, 13);
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
      { interviews: 10 },
      { interviews: 11 },
      new Set<string>(['interviews']),
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
