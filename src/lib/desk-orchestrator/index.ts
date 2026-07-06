// Desk orchestrator dispatch — 3 mode 모두 미리 wire 되어 있다 (shell PR 이
// 완결). 후속 mode PR 들은 자기 파일만 교체한다:
//   - market PR(D): market.ts 의 runMarket stub → 실 로직 replace
//   - custom PR(E): custom.ts 안에 판단 로그 라인 추가
// 이 파일(index.ts)과 route.ts 는 재편집하지 않는다 — 병렬 launch 충돌 방지.

import type { DeskMode, OrchestratorInput, OrchestratorPlan } from './types';
import { runTrend } from './trend';
import { runMarket } from './market';
import { runCustom } from './custom';

export {
  NotImplementedYet,
  TREND_SOURCE_IDS,
  isJudgmentEvent,
  JUDGMENT_EVENT_MARKERS,
  DESK_MODES,
} from './types';
export type {
  DeskMode,
  OrchestratorInput,
  OrchestratorPlan,
  CrawlTask,
  ReportContext,
} from './types';

export async function runOrchestrator(
  mode: DeskMode,
  input: OrchestratorInput,
): Promise<OrchestratorPlan> {
  switch (mode) {
    case 'trend':
      return runTrend(input);
    case 'market':
      return runMarket(input);
    case 'custom':
      return runCustom(input);
  }
}
