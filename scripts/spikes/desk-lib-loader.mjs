// ── Spike-only ESM resolver hook (card 584) ─────────────────────────────────
//
// 스펙 "기존 lib 재사용 — 복제 금지" 를 지키려면 이 스파이크 러너가 현행 데스크
// 웹 레인의 **실제** 소스 어댑터(src/lib/desk-sources/*.ts)를 그대로 import 해야
// 한다. 그런데 형제 스파이크(stt-eval.ts)가 문서화했듯, 이 repo 의 ops 스크립트는
// `node --experimental-strip-types` 로 돌고, 이 실행기는 (1) `@/` 경로 별칭과
// (2) 확장자 없는 상대 import(`./helpers`) 를 해석하지 못한다 — 오직 Next 번들러만
// 그걸 한다. `tsx`/`ts-node` 추가는 "프로덕션 무변경(의존성 0)" 제약 위반이다.
//
// 이 로더는 **의존성 없이**(Node 내장 모듈만) 그 두 간극만 메운다:
//   1. `@/env`            → env-shim.ts (process.env 를 그대로 노출 — 키 출처는 동일
//                           .env.local, @t3-oss zod 검증만 우회. fetch 로직은 실코드)
//   2. 그 외 `@/x`         → 절대경로 src/x 로 rewrite
//   3. 확장자 없는 specifier → 해석 실패 시 `.ts` 를 붙여 재시도(상대·절대 공통)
//
// types.ts 의 `import type { MacroObservation } from '@/lib/global-macro/normalize'`
// 같은 **type-only** import 는 --experimental-strip-types 가 지워버리므로 런타임
// 해석이 필요 없다. helpers.ts 도 런타임 import 는 type-only 뿐 → 실제 런타임
// 그래프는 @/env(shim) + 상대 .ts + @/lib/web-search/tavily 만 남는다.
//
// 로드된 .ts 의 타입 스트립은 Node 기본 load 단계가 담당한다(로더는 resolve 만
// 손댐). 앱 코드는 이 로더 밖에서는 전혀 바뀌지 않는다.

// 로더는 scripts/spikes/ 에 있다 → repo src/ 는 ../../src/
const SRC_DIR = new URL('../../src/', import.meta.url);
const ENV_SHIM = new URL('./env-shim.ts', import.meta.url).href;

async function tryResolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // 확장자 없는 specifier 면 .ts / /index.ts 를 붙여 재시도(상대·절대 공통).
    if (!/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          /* 다음 후보로 */
        }
      }
    }
    throw err;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/env') {
    return nextResolve(ENV_SHIM, context);
  }
  if (specifier.startsWith('@/')) {
    const abs = new URL(specifier.slice(2), SRC_DIR).href;
    return tryResolve(abs, context, nextResolve);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return tryResolve(specifier, context, nextResolve);
  }
  return nextResolve(specifier, context);
}
