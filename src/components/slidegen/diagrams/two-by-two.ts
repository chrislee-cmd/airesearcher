// two_by_two — 4-사분면 매트릭스 (SPEC §4.4).
//
// 두 독립 축으로 항목을 분류/포지셔닝하는 컨설팅 단골 도식. xAxis low/high,
// yAxis low/high, 그리고 정확히 4개의 quadrant(TL/TR/BL/BR)로 구성.

import type {
  DiagramTemplate,
  SlideElement,
  TwoByTwoPayload,
} from '../types';
import { THEME } from '../types';

// Grid geometry — content band 148~680 (slide composer reserves 0..147
// for title + accent). 56px left/right gutters match bullet_body.
const AXIS_LABEL_W = 70;
const GRID_X = 140;
const GRID_Y = 160;
const GRID_W = 1024;
const GRID_H = 460;
const HALF_W = GRID_W / 2;
const HALF_H = GRID_H / 2;
const Q_PAD = 14;

const ORDER: TwoByTwoPayload['quadrants'][number]['position'][] = [
  'TL',
  'TR',
  'BL',
  'BR',
];

function isTwoByTwoPayload(p: unknown): p is TwoByTwoPayload {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  if (!isAxis(x.xAxis) || !isAxis(x.yAxis)) return false;
  if (!Array.isArray(x.quadrants) || x.quadrants.length !== 4) return false;
  const seen = new Set<string>();
  for (const q of x.quadrants) {
    if (!q || typeof q !== 'object') return false;
    const qq = q as Record<string, unknown>;
    if (
      qq.position !== 'TL' &&
      qq.position !== 'TR' &&
      qq.position !== 'BL' &&
      qq.position !== 'BR'
    )
      return false;
    if (seen.has(qq.position)) return false;
    seen.add(qq.position);
    if (typeof qq.label !== 'string') return false;
    if (!Array.isArray(qq.items) || !qq.items.every((i) => typeof i === 'string'))
      return false;
  }
  return seen.size === 4;
}

function isAxis(v: unknown): v is { low: string; high: string } {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.low === 'string' && typeof a.high === 'string';
}

function quadrantBox(position: 'TL' | 'TR' | 'BL' | 'BR') {
  const left = position === 'TL' || position === 'BL' ? GRID_X : GRID_X + HALF_W;
  const top = position === 'TL' || position === 'TR' ? GRID_Y : GRID_Y + HALF_H;
  return { x: left, y: top, w: HALF_W, h: HALF_H };
}

function toElements(payload: TwoByTwoPayload): SlideElement[] {
  const elements: SlideElement[] = [];

  // Outer hairline + center cross. Two thin rects make the cross so we
  // can keep everything as rect elements (PptxGenJS exporter friendly).
  elements.push({
    id: 'tbt-grid-frame',
    type: 'rect',
    x: GRID_X,
    y: GRID_Y,
    w: GRID_W,
    h: GRID_H,
    border: THEME.hairline,
  });
  elements.push({
    id: 'tbt-grid-vsplit',
    type: 'rect',
    x: GRID_X + HALF_W - 0.5,
    y: GRID_Y,
    w: 1,
    h: GRID_H,
    fill: THEME.hairline,
  });
  elements.push({
    id: 'tbt-grid-hsplit',
    type: 'rect',
    x: GRID_X,
    y: GRID_Y + HALF_H - 0.5,
    w: GRID_W,
    h: 1,
    fill: THEME.hairline,
  });

  // yAxis labels — vertical axis runs alongside the grid's left edge.
  // `high` sits next to the top half, `low` next to the bottom half.
  elements.push({
    id: 'tbt-y-high',
    type: 'text',
    x: 56,
    y: GRID_Y,
    w: AXIS_LABEL_W,
    h: HALF_H,
    content: payload.yAxis.high,
    fontSize: 12,
    fontWeight: 'bold',
    color: THEME.muted,
    align: 'right',
    valign: 'middle',
    lineHeight: 1.3,
  });
  elements.push({
    id: 'tbt-y-low',
    type: 'text',
    x: 56,
    y: GRID_Y + HALF_H,
    w: AXIS_LABEL_W,
    h: HALF_H,
    content: payload.yAxis.low,
    fontSize: 12,
    fontWeight: 'bold',
    color: THEME.muted,
    align: 'right',
    valign: 'middle',
    lineHeight: 1.3,
  });

  // xAxis labels under the grid, split at the center.
  elements.push({
    id: 'tbt-x-low',
    type: 'text',
    x: GRID_X,
    y: GRID_Y + GRID_H + 8,
    w: HALF_W,
    h: 32,
    content: payload.xAxis.low,
    fontSize: 12,
    fontWeight: 'bold',
    color: THEME.muted,
    align: 'left',
    valign: 'top',
    lineHeight: 1.3,
  });
  elements.push({
    id: 'tbt-x-high',
    type: 'text',
    x: GRID_X + HALF_W,
    y: GRID_Y + GRID_H + 8,
    w: HALF_W,
    h: 32,
    content: payload.xAxis.high,
    fontSize: 12,
    fontWeight: 'bold',
    color: THEME.muted,
    align: 'right',
    valign: 'top',
    lineHeight: 1.3,
  });

  // Per-quadrant: label band + accent stripe + items text. We render in
  // ORDER (not payload order) so missing positions just no-op cleanly,
  // and adjacent z-order matches the position grid.
  const byPosition = new Map(payload.quadrants.map((q) => [q.position, q]));
  for (const position of ORDER) {
    const q = byPosition.get(position);
    if (!q) continue;
    const box = quadrantBox(position);

    elements.push({
      id: `tbt-q-${position}-accent`,
      type: 'rect',
      x: box.x + Q_PAD,
      y: box.y + Q_PAD,
      w: 4,
      h: 20,
      fill: THEME.accent,
    });
    elements.push({
      id: `tbt-q-${position}-label`,
      type: 'text',
      x: box.x + Q_PAD + 12,
      y: box.y + Q_PAD - 2,
      w: box.w - Q_PAD * 2 - 12,
      h: 24,
      content: q.label,
      fontSize: 14,
      fontWeight: 'bold',
      color: THEME.ink,
      align: 'left',
      valign: 'middle',
      lineHeight: 1.2,
    });
    elements.push({
      id: `tbt-q-${position}-items`,
      type: 'text',
      x: box.x + Q_PAD,
      y: box.y + Q_PAD + 30,
      w: box.w - Q_PAD * 2,
      h: box.h - Q_PAD * 2 - 30,
      content: q.items.map((item) => `•  ${item}`).join('\n'),
      fontSize: 12,
      fontWeight: 'normal',
      color: THEME.ink,
      align: 'left',
      valign: 'top',
      lineHeight: 1.5,
    });
  }

  return elements;
}

export const twoByTwoTemplate: DiagramTemplate<TwoByTwoPayload> = {
  type: 'two_by_two',
  label: '2×2 매트릭스',
  selectionHint:
    '두 독립 축으로 항목을 분류·포지셔닝할 때. 우선순위(영향 × 빈도), 평가(가치 × 노력), 경쟁(차별성 × 시장규모) 등.',
  validate: isTwoByTwoPayload,
  toElements,
};
