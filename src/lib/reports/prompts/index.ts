import type { ReportType } from '../types';
import { reportLangOverrideBlock } from './_shared';
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

// locale 을 넘기면 산출물 출력 언어를 그 로케일로 파라미터화한다(i18n Phase 7).
// non-ko 는 NORMALIZE/GENERATE/SLIDES 프롬프트 말미에 언어 오버라이드 블록을
// 덧붙여 산출물을 해당 언어로 강제(한국어 톤 규칙은 무시). ko / locale 미전달은
// 기존 동작 그대로(오버라이드 빈 문자열).
export function getReportPrompts(
  type: ReportType,
  locale?: string | null,
): PromptModule {
  const mod = MODULES[type];
  const override = reportLangOverrideBlock(locale);
  if (!override) return mod;
  return {
    ...mod,
    NORMALIZE_SYSTEM: mod.NORMALIZE_SYSTEM + override,
    GENERATE_SYSTEM: mod.GENERATE_SYSTEM + override,
    SLIDES_HINT: mod.SLIDES_HINT + override,
  };
}
