// Desk orchestrator dispatch — 2 mode (trend/market) 모두 미리 wire 되어 있다
// (shell PR 이 완결). 후속 mode PR 들은 자기 파일만 교체한다:
//   - market PR(D): market.ts 의 runMarket stub → 실 로직 replace
// custom mode 는 제거됨 (fix/desk-remove-custom-mode).

import type { DeskMode, OrchestratorInput, OrchestratorPlan } from './types';
import { runTrend } from './trend';
import { runMarket } from './market';

export {
  NotImplementedYet,
  TREND_SOURCE_IDS,
  isJudgmentEvent,
  JUDGMENT_EVENT_MARKERS,
  DESK_MODES,
  DESK_COUNTRY_SCOPES,
  DEFAULT_COUNTRY_SCOPE,
} from './types';
export type {
  DeskMode,
  DeskCountryScope,
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
  }
}
