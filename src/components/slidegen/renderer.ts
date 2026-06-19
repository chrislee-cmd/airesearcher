// Slide composer — SlideSpec → SlideElement[]. Wraps `registry.renderPayload`
// with the slide-chrome elements (action title + accent underline) that every
// layout shares. The canvas and the (future) PptxGenJS exporter call this so
// the chrome geometry stays in one place.

import type { SlideElement, SlideSpec } from './types';
import { THEME } from './types';
import { renderPayload } from './diagrams/registry';

const TITLE = { x: 56, y: 48, w: 1168, h: 60 };
const ACCENT = { x: 56, y: 118, w: 56, h: 4 };

export function composeSlide(slide: SlideSpec): SlideElement[] {
  const elements: SlideElement[] = [
    {
      id: 'slide-title',
      type: 'text',
      ...TITLE,
      content: slide.actionTitle,
      fontSize: 22,
      fontWeight: 'bold',
      color: THEME.ink,
      align: 'left',
      valign: 'middle',
      lineHeight: 1.2,
    },
    {
      id: 'slide-accent',
      type: 'rect',
      ...ACCENT,
      fill: THEME.accent,
    },
    ...renderPayload(slide.layoutType, slide.payload),
  ];
  return elements;
}
