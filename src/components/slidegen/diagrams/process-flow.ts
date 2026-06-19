// process_flow — 단계별 박스 + 화살표 (SPEC §4.4).
//
// 시계열·인과·절차를 단계로 시각화하는 컨설팅 단골 도식. 단계 박스 마다
// 짧은 타이틀과 한두 줄 설명이 들어가고, 사이를 → 화살표로 연결한다.
// 단계는 1~6개를 허용; 그 이상은 가독성이 무너지므로 classifier가 거른다.

import type {
  DiagramTemplate,
  ProcessFlowPayload,
  SlideElement,
} from '../types';
import { THEME } from '../types';

// Content band starts at y=148 (title + accent line 위쪽 reserve 영역).
// 박스 높이 220 을 y=308 부터 두면 시각적 중앙(y=418)이 슬라이드 중심에
// 정확히 맞고, 아래에 화살표/캡션 추가 여유도 남는다.
const CONTENT_X = 56;
const CONTENT_W = 1168;
const GAP = 28;
const BOX_H = 220;
const BOX_Y = 308;
const ARROW_FONT = 32;
const MIN_STEPS = 1;
const MAX_STEPS = 6;

function isProcessFlowPayload(p: unknown): p is ProcessFlowPayload {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  if (!Array.isArray(x.steps)) return false;
  if (x.steps.length < MIN_STEPS || x.steps.length > MAX_STEPS) return false;
  for (const s of x.steps) {
    if (!s || typeof s !== 'object') return false;
    const ss = s as Record<string, unknown>;
    if (typeof ss.order !== 'number') return false;
    if (typeof ss.title !== 'string') return false;
    if (typeof ss.desc !== 'string') return false;
  }
  return true;
}

function toElements(payload: ProcessFlowPayload): SlideElement[] {
  const steps = [...payload.steps].sort((a, b) => a.order - b.order);
  const n = steps.length;
  const boxW = (CONTENT_W - GAP * (n - 1)) / n;
  const elements: SlideElement[] = [];

  steps.forEach((step, i) => {
    const boxX = CONTENT_X + i * (boxW + GAP);

    elements.push({
      id: `pf-${i}-box`,
      type: 'rect',
      x: boxX,
      y: BOX_Y,
      w: boxW,
      h: BOX_H,
      border: THEME.hairline,
      borderRadius: 4,
    });
    elements.push({
      id: `pf-${i}-top`,
      type: 'rect',
      x: boxX,
      y: BOX_Y,
      w: boxW,
      h: 4,
      fill: THEME.accent,
    });
    elements.push({
      id: `pf-${i}-num`,
      type: 'text',
      x: boxX + 18,
      y: BOX_Y + 18,
      w: 60,
      h: 18,
      content: String(i + 1).padStart(2, '0'),
      fontSize: 13,
      fontWeight: 'bold',
      color: THEME.accent,
      align: 'left',
      valign: 'top',
      lineHeight: 1,
    });
    elements.push({
      id: `pf-${i}-title`,
      type: 'text',
      x: boxX + 18,
      y: BOX_Y + 48,
      w: boxW - 36,
      h: 48,
      content: step.title,
      fontSize: 18,
      fontWeight: 'bold',
      color: THEME.ink,
      align: 'left',
      valign: 'top',
      lineHeight: 1.25,
    });
    elements.push({
      id: `pf-${i}-desc`,
      type: 'text',
      x: boxX + 18,
      y: BOX_Y + 104,
      w: boxW - 36,
      h: BOX_H - 104 - 18,
      content: step.desc,
      fontSize: 13,
      fontWeight: 'normal',
      color: THEME.ink,
      align: 'left',
      valign: 'top',
      lineHeight: 1.55,
    });

    if (i < n - 1) {
      const arrowX = boxX + boxW;
      elements.push({
        id: `pf-${i}-arrow`,
        type: 'text',
        x: arrowX,
        y: BOX_Y + BOX_H / 2 - ARROW_FONT / 2 - 4,
        w: GAP,
        h: ARROW_FONT,
        content: '→',
        fontSize: ARROW_FONT,
        fontWeight: 'normal',
        color: THEME.muted,
        align: 'center',
        valign: 'middle',
        lineHeight: 1,
      });
    }
  });

  return elements;
}

export const processFlowTemplate: DiagramTemplate<ProcessFlowPayload> = {
  type: 'process_flow',
  label: '단계 흐름',
  selectionHint:
    '시계열·인과·절차를 단계로 나누어 보여줄 때. 진단→설계→검증→확장, As-is→To-be, 분기별 마일스톤 등.',
  validate: isProcessFlowPayload,
  toElements,
};
