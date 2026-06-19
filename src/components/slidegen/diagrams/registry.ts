// Diagram registry — single lookup table the renderer and the (future)
// LLM classifier both consume. Per SPEC §5: adding a diagram = drop one
// template module here + one registry line, no pipeline changes.

import type { DiagramTemplate, LayoutType, SlideElement } from '../types';
import { bulletBodyTemplate } from './bullet-body';
import { twoByTwoTemplate } from './two-by-two';
import { processFlowTemplate } from './process-flow';
import { pyramidTemplate } from './pyramid';

// PR1 shipped bullet_body. PR2 added two_by_two. PR3 added process_flow.
// PR4 adds pyramid — SPEC §11 "다음 우선순위" 시리즈를 마감.
const TEMPLATES: Record<string, DiagramTemplate<unknown>> = {
  [bulletBodyTemplate.type]: bulletBodyTemplate as DiagramTemplate<unknown>,
  [twoByTwoTemplate.type]: twoByTwoTemplate as DiagramTemplate<unknown>,
  [processFlowTemplate.type]: processFlowTemplate as DiagramTemplate<unknown>,
  [pyramidTemplate.type]: pyramidTemplate as DiagramTemplate<unknown>,
};

export function getTemplate(
  type: LayoutType,
): DiagramTemplate<unknown> | undefined {
  return TEMPLATES[type];
}

export function renderPayload(
  type: LayoutType,
  payload: unknown,
): SlideElement[] {
  const template = getTemplate(type);
  if (!template) return [];
  if (!template.validate(payload)) return [];
  return template.toElements(payload);
}

export function listTemplates(): DiagramTemplate<unknown>[] {
  return Object.values(TEMPLATES);
}
