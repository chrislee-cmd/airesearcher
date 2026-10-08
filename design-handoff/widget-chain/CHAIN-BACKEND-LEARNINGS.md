# pr-chain-steps-patch — 세션 지식 (A″ PATCH steps)

## 1. "전 단계 pending" 인 체인은 존재하지 않는다 (스펙 전제 오류)

스펙은 수정 허용 상태를 "전 단계 pending 인 running-전 상태"로 적었지만,
생성 라우트(`src/app/api/chains/route.ts`)가 마지막에 이렇게 한다:

```ts
const chainStatus = mode === 'auto' ? 'running' : 'awaiting_approval';
steps[0] = { ...steps[0], status: chainStatus };
```

즉 **활성 단계 = 체인 status 미러**가 A 시절부터의 불변 규칙이고, 그래서
`steps[].status` 전수 pending 인 행은 DB 에 **한 번도 존재하지 않는다**.
`skipStep` 의 다음-단계 세팅도 같은 규칙을 따른다. 체인 steps 를 다루는 후속
작업은 이 규칙을 먼저 확인할 것 — "pending 이면 미실행" 이라는 직관은
`steps[0]` 에서 깨진다. 미실행 판별은 **`job_ref`가 비었는지 + 진행 마킹
(done/skipped/error/running)이 없는지**로 해야 한다.

## 2. status·current_step CAS 만으로는 steps 교체를 감지할 수 없다

`casChain` 의 술어는 `status`(+ 선택적 `current_step`)였다. 그런데
`approveChain`/`skipStep` 은 **낡은 steps 스냅샷**에서 다음 steps 를 파생한다.
조립 수정(PATCH)은 `status`·`current_step` 을 **그대로 두고 steps 만** 바꾸므로,
"PATCH 성공 → 직후 승인 도착" 순서에서 승인의 CAS 가 그대로 통과하고 **구
조립이 조용히 되살아난다**(사용자가 본 체인 ≠ 실제로 도는 체인).

해법: `updated_at` 을 낙관적 잠금 토큰으로 CAS 에 추가(`expectedUpdatedAt`).
`widget_chains_updated_at` 트리거가 모든 update 에서 bump 하므로 추가 컬럼·
마이그가 필요 없다. **steps 를 read-modify-write 하는 전이는 앞으로 전부 이
토큰을 넘길 것.**

## 3. advance 와의 경합은 "상태 선택"으로 피했다 (CAS 로 못 가르는 구간)

`advance.findChainAtStep` 은 `status='running'` **+ 현재 단계 `status='running'`**
만 매칭한다. 따라서 `awaiting_approval` 체인은 advance 가 구조적으로 손댈 수
없고, 수정 허용 상태를 그것으로 한정하면 경합 자체가 사라진다.

반대로 **auto 모드 생성 직후**(`status='running'`, `steps[0]='running'`,
`job_ref=null`)는 advance 의 채택(adoption) 대상이다. 이 구간에서는
수정도 전진도 `status`·`current_step` 을 바꾸지 않아 **CAS 로 선후를 가릴
방법이 없다**(advance 가 들고 있는 스냅샷은 PATCH 전 값이고, 그 CAS 는 PATCH
후에도 여전히 매칭된다). 그래서 auto 는 수정 대상에서 제외했다. 나중에 auto
를 열어야 하면 `steps_version` 정수 컬럼(마이그 1)을 advance 의 CAS 술어에
넣는 쪽이 정답 — `updated_at` 토큰은 advance 가 best-effort `patchStep` 으로
스스로 bump 하는 경로가 있어 그쪽에는 바로 쓰기 어렵다.

## 4. `tests/` 는 의존성 없는 순수 모듈만 테스트할 수 있다

`pnpm test` = `node --experimental-strip-types --test tests/**/*.test.ts`.
로더가 없어 **import 대상 모듈이 확장자 없는 상대 import 를 value 로 가지면
해석 실패**한다(`./registry` → `./registry.ts` 미보정). `state.ts` 를 테스트
가능하게 유지하려고 `instantiateSteps` 를 state.ts 에 끌어오지 않고 **라우트가
steps 를 조립해서 넘기는 형태**(`replaceChainSteps(admin, row, steps)`)로 뒀다 —
덤으로 "활성 단계 = 체인 status 미러" 규칙의 소유자가 생성 라우트와 동일하게
라우트 레이어로 유지된다. 또한 `tests/` 는 **CI 게이트가 아니다**(ci.yml 에
`pnpm test` 없음) — 로컬 검증용.

## 5. A′ POST 는 `validateSteps` 의 `from`/`to` 를 버린다

`validateSteps` 는 `incompatible_steps` 에서 막힌 쌍을 `from`/`to` 로도 주는데
POST 는 `{error, detail}` 만 돌려준다. PATCH 는 스펙 요구대로 `from`/`to` 를
포함했으므로 **두 라우트의 400 body 가 엄격한 superset 관계**다(코드·detail
동일). UI 가 로케일 문구를 구조로 조립하려면 POST 도 맞춰야 한다 — A′ 파일
수정이라 본 PR 범위 밖, 후속 1줄짜리 후보.
