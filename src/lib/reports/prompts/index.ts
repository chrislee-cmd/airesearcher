import type { ReportType } from '../types';
import * as design from './design';
import * as findings from './findings';
import * as marketing from './marketing';
import * as strategy from './strategy';

type PromptModule = {
  NORMALIZE_SYSTEM: string;
  GENERATE_SYSTEM: string;
  SLIDES_HINT: string;
  TEMPERATURE: { normalize: number; generate: number };
};

const MODULES: Record<ReportType, PromptModule> = {
  design,
  marketing,
  strategy,
  findings,
};

export function getReportPrompts(type: ReportType): PromptModule {
  return MODULES[type];
}
