// bullet_body — universal fallback layout (SPEC §4.4).
//
// Body 한 줄 인트로(선택) + 불릿 리스트. 매트릭스/프로세스/피라미드 같은
// 도식형 분류기 출력이 검증을 통과하지 못할 때 이 템플릿으로 폴백한다.

import type {
  BulletBodyPayload,
  DiagramTemplate,
  SlideElement,
} from '../types';
import { THEME } from '../types';

// Content area, in canvas px. Title + accent line sit above (placed by
// the slide composer, not here).
const CONTENT_X = 56;
const CONTENT_W = 1168;
const CONTENT_Y = 148;

function isBulletBodyPayload(p: unknown): p is BulletBodyPayload {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  if (!Array.isArray(x.bullets)) return false;
  if (!x.bullets.every((b) => typeof b === 'string')) return false;
  if (x.body !== null && typeof x.body !== 'string') return false;
  return true;
}

function toElements(payload: BulletBodyPayload): SlideElement[] {
  const elements: SlideElement[] = [];
  let cursor = CONTENT_Y;

  if (payload.body && payload.body.trim().length > 0) {
    const bodyH = 60;
    elements.push({
      id: 'body-intro',
      type: 'text',
      x: CONTENT_X,
      y: cursor,
      w: CONTENT_W,
      h: bodyH,
      content: payload.body,
      fontSize: 16,
      fontWeight: 'normal',
      color: THEME.ink,
      align: 'left',
      valign: 'top',
      lineHeight: 1.5,
    });
    cursor += bodyH + 16;
  }

  // Bullets share the remaining vertical space, capped at a readable
  // row height so 2-bullet slides don't balloon each line to 200px.
  const remaining = 680 - cursor;
  const rowH = Math.min(
    56,
    Math.max(28, Math.floor(remaining / Math.max(payload.bullets.length, 1))),
  );

  payload.bullets.forEach((bullet, i) => {
    elements.push({
      id: `bullet-${i}`,
      type: 'text',
      x: CONTENT_X,
      y: cursor + i * rowH,
      w: CONTENT_W,
      h: rowH,
      content: `▸  ${bullet}`,
      fontSize: 15,
      fontWeight: 'normal',
      color: THEME.ink,
      align: 'left',
      valign: 'middle',
      lineHeight: 1.4,
    });
  });

  return elements;
}

export const bulletBodyTemplate: DiagramTemplate<BulletBodyPayload> = {
  type: 'bullet_body',
  label: '불릿 본문',
  selectionHint:
    '항목이 도식 구조(매트릭스·프로세스·피라미드)에 맞지 않고 단순한 키 포인트 나열일 때 사용.',
  validate: isBulletBodyPayload,
  toElements,
};
