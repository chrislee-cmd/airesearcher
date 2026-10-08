# pr-chain-adoption-awaiting — 세션 지식 (B′ 조립 완료 체인 채택)

## 1. 채택 풀은 **우선순위**로 소진해야 한다 — 합치면 기존 경로가 회귀한다

`findChainAtStep` 의 "후보가 정확히 1개일 때만 채택, 2개 이상이면 ambiguous"
규칙에 `awaiting_approval` 후보를 **같은 풀로** 합치면 안 된다. 같은 org 에
살아 있는 조립 체인 하나가 **기존 running 채택을 ambiguous 로 끌어내려**,
지금까지 정상 전진했던 경로를 조용히 no-op 으로 만든다(체인 project_id 는
프로빙 진입 직후 null 이라 스코프로도 안 갈라진다 — 교차 검증이 "양쪽 다
있고 다를 때" 만 작동하므로).

그래서 풀을 셋으로 나눠 **먼저 걸린 풀에서 끝낸다**: exact(job_ref 일치) →
adopt_running → adopt_assembly. ambiguous 판정도 **풀 안에서만** 한다.
근거: running 체인은 이미 라이브 오케스트레이션이라 이 완료 이벤트에 대한
권리가 더 강하고, 조립 체인은 아직 pre-start 다. 기능 추가가 기존 경로의
판정을 건드리지 않게 하는 일반 패턴 — 매칭 규칙을 넓힐 때는 "집합을
넓히기"가 아니라 "뒤에 풀을 하나 붙이기"로 한다.

## 2. 진입 단계 일치는 `steps[0]` 로 봐야 한다 (`steps.some` 아님)

조립 체인은 커서가 0 이므로 "완료된 feature 가 이 체인에 들어 있는가" 가
아니라 "**진입 단계가 그 feature 인가**" 를 물어야 한다. `some()` 으로
느슨하게 보면 뒤쪽 칸의 feature 가 우연히 맞는 체인을 채택해 커서를 건너뛴
채 전진시킨다(예: `[transcripts, interview_ingest]` 조립 체인이 probing
완료 훅에 반응). 조립 체인은 "아직 한 칸도 안 움직였다" 가 전제이므로
`steps[0].feature === sourceFeature` 가 유일하게 맞는 술어다.

## 3. approve 모드의 "채택"은 "승인"이 아니다 — 다음 단계 게이트는 그대로다

채택된 체인은 pre-start 창에서 빠져나와 **커서 1 의 진짜 승인 게이트**로
간다(approve 모드). 즉 "running 승격"은 체인이 라이브 오케스트레이션으로
들어간다는 뜻이고, 다음 단계를 승인 없이 kick 한다는 뜻이 **아니다**.
진입 단계를 사용자가 직접 돌린 것이 그 단계의 승인을 대신할 뿐, 다음 단계는
모드가 정한 게이트를 그대로 받는다 — 그래야 #1024 의 해독제(매 단계 크레딧
사전 고지)가 채택 경로로 뒷문을 내주지 않는다. 기존 running 전진 분기를
그대로 재사용하면 이게 자동으로 지켜진다(별도 분기를 만들면 안 되는 이유).

## 4. 이 PR 은 E 집계와 sweep 을 **개선**한다 (오염이 아니라 교정)

작업 전 우려("awaiting 이 '승인 대기'와 '조립 완료 대기' 두 의미를 갖는다")는
**이 PR 이 만든 게 아니라 A″/D-v3 부터 이미 있던 상태**이고, 이 PR 은 그
모호한 모집단을 **줄인다**(조립 체인이 방치되지 않고 전진하므로).

더 중요한 두 가지 교정:
- **단계 집계**: 전에는 사용자가 실제로 끝낸 진입 단계가 `awaiting_approval`
  로 영구히 남아 `done` 으로 세어지지 않았다 → 단계 완료율 과소 집계.
- **chain-sweep**: 그 체인은 24h 뒤 `chain_stalled` 로 닫혀 **거짓 실패**가
  파일럿 평가 데이터에 적재됐다. 이제 전진하므로 그 거짓 실패가 사라진다.
  (sweep 과의 경합도 안전 — sweep 이 먼저 닫으면 status 가 `error` 라 채택
  CAS 가 떨어진다.)

남은 되물림 후보(E 트랙, 본 PR 범위 밖): 어드민 상태 분포의
`awaiting_approval` 라벨이 '승인 대기' 하나다. pre-start 조립과 진짜 승인
대기를 가르려면 `current_step`/`job_ref` 로 쪼개야 하는데, 그건
`src/lib/admin/chain-observability.ts` 수정이라 E 소관.

## 5. 순수 판정·계획을 state.ts 로 내리면 CAS 술어까지 테스트된다

advance.ts 는 `@/env`·supabase admin·fetch 를 import 해 `tests/` 로더가
해석하지 못한다(A″ 학습기록 §4). 그래서 "어느 체인을 고르나"
(`pickChainForStepEvent`)와 "어떻게 전진시키나"(`planStepAdvance` — CAS 술어
+ patch 를 **값으로** 반환)를 state.ts 의 순수 함수로 내렸다. 덕분에
advance.ts 는 "쿼리 → plan → casChain → kick" 네 줄로 얇아지고,
**경합 판별(어느 경로가 updated_at 토큰을 들고 가는가)이 단위 테스트의
대상이 된다** — DB 없이 양방향 경합을 고정할 수 있는 유일한 지점.
