// Market mode — 시장조사 (통계·공시, TAM/SAM 참고 데이터 세트). 아직 stub:
// 후속 market PR(D) 이 이 파일 하나만 실 로직으로 교체한다 (index.ts /
// route.ts / types.ts 재편집 금지 — 충돌 매트릭스). client 는 실행 전에
// "곧 제공됩니다" toast 로 막지만, API 직접 호출 시 이 throw 가 서버측
// 최종 가드다 — runner 가 잡아 크레딧 환불 + not_implemented_yet 로 마무리.

import { NotImplementedYet, type OrchestratorInput, type OrchestratorPlan } from './types';

export async function runMarket(
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  // stub: 시그니처(입력 계약)만 고정해 두고 소비하지 않는다 — 후속 market
  // PR 이 이 body 를 실 로직으로 교체한다.
  void input;
  throw new NotImplementedYet('market');
}
