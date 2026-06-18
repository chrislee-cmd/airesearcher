// Diagram registry — single lookup table the renderer and the (future)
// LLM classifier both consume. Per SPEC §5: adding a diagram = drop one
// template module here + one registry line, no pipeline changes.

import type { DiagramTemplate, LayoutType, SlideElement } from '../types';
import { bulletBodyTemplate } from './bullet-body';

// Only bullet_body in PR1. two_by_two / process_flow / pyramid land in
// per-diagram PRs (see SPEC §11 "다음 우선순위").
const TEMPLATES: Record<string, DiagramTemplate<unknown>> = {
  [bulletBodyTemplate.type]: bulletBodyTemplate as DiagramTemplate<unknown>,
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
