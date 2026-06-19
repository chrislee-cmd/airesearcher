// pyramid — 계층형 피라미드 (SPEC §4.4).
//
// 상위 개념에서 하위 실행으로 내려가는 계층 구조를 시각화. 비전→가치→
// 원칙→실행, 전략→전술→오퍼레이션, Maslow 류 욕구 단계 등. 2~5단을
// 허용하고, 그 이상은 가독성이 깨지므로 classifier 가 거른다.
//
// 좌측에 피라미드 (apex=상위, base=하위), 우측에 단계별 설명 컬럼.
// 정점(tier 1) 은 accent 로 강조해 "핵심" 을 즉시 읽히게 한다.

import type {
  DiagramTemplate,
  PyramidPayload,
  SlideElement,
} from '../types';
import { THEME } from '../types';

// Geometry — 슬라이드의 절반 살짝 안쪽까지가 피라미드 영역, 나머지는
// 설명 컬럼. 정점은 200px 폭, 밑변은 580px 폭으로 점차 확장.
const PYRAMID_X_CENTER = 380;
const PYRAMID_TOP_W = 200;
const PYRAMID_BASE_W = 580;
const PYRAMID_TOP_Y = 160;
const PYRAMID_H = 480;
const DESC_X = 700;
const DESC_W = 524;
const MIN_LEVELS = 2;
const MAX_LEVELS = 5;

function isPyramidPayload(p: unknown): p is PyramidPayload {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  if (!Array.isArray(x.levels)) return false;
  if (x.levels.length < MIN_LEVELS || x.levels.length > MAX_LEVELS) return false;
  for (const l of x.levels) {
    if (!l || typeof l !== 'object') return false;
    const ll = l as Record<string, unknown>;
    if (typeof ll.tier !== 'number') return false;
    if (typeof ll.label !== 'string') return false;
    if (typeof ll.desc !== 'string') return false;
  }
  return true;
}

function toElements(payload: PyramidPayload): SlideElement[] {
  const levels = [...payload.levels].sort((a, b) => a.tier - b.tier);
  const n = levels.length;
  const levelH = PYRAMID_H / n;
  const elements: SlideElement[] = [];

  levels.forEach((lvl, i) => {
    const bandTop = PYRAMID_TOP_Y + i * levelH;
    const frac = n === 1 ? 0.5 : i / (n - 1);
    const bandW = PYRAMID_TOP_W + (PYRAMID_BASE_W - PYRAMID_TOP_W) * frac;
    const bandX = PYRAMID_X_CENTER - bandW / 2;
    const isApex = i === 0;

    elements.push({
      id: `py-${i}-band`,
      type: 'rect',
      x: bandX,
      y: bandTop,
      w: bandW,
      h: levelH,
      border: THEME.hairline,
      fill: isApex ? THEME.accent : THEME.paper,
    });
    elements.push({
      id: `py-${i}-label`,
      type: 'text',
      x: bandX,
      y: bandTop,
      w: bandW,
      h: levelH,
      content: lvl.label,
      fontSize: bandW > 400 ? 18 : bandW > 280 ? 16 : 14,
      fontWeight: 'bold',
      color: isApex ? THEME.paper : THEME.ink,
      align: 'center',
      valign: 'middle',
      lineHeight: 1.2,
    });

    elements.push({
      id: `py-${i}-num`,
      type: 'text',
      x: DESC_X,
      y: bandTop,
      w: 40,
      h: levelH,
      content: String(i + 1).padStart(2, '0'),
      fontSize: 13,
      fontWeight: 'bold',
      color: THEME.accent,
      align: 'left',
      valign: 'middle',
      lineHeight: 1,
    });
    elements.push({
      id: `py-${i}-desc`,
      type: 'text',
      x: DESC_X + 48,
      y: bandTop + 8,
      w: DESC_W - 48,
      h: levelH - 16,
      content: lvl.desc,
      fontSize: 13,
      fontWeight: 'normal',
      color: THEME.ink,
      align: 'left',
      valign: 'middle',
      lineHeight: 1.5,
    });
  });

  return elements;
}

export const pyramidTemplate: DiagramTemplate<PyramidPayload> = {
  type: 'pyramid',
  label: '계층 피라미드',
  selectionHint:
    '상위 개념 → 하위 실행의 계층 구조를 보여줄 때. 비전→가치→원칙→실행, 전략→전술→오퍼레이션 등.',
  validate: isPyramidPayload,
  toElements,
};
