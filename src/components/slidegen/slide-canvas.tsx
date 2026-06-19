'use client';

import type { CSSProperties } from 'react';
import type { SlideElement } from './types';
import { CANVAS_H, CANVAS_W, THEME } from './types';

// Read-only canvas. PR1 ships the renderer half of the SPEC §3 pipeline
// (DeckSpec → Element[] → DOM). The editor (selection, handles, inline
// edit, toolbar) lands in PR2.
//
// The viewport keeps the canvas's 16:9 ratio; Element coordinates are
// scaled by `viewportW / 1280` and inlined as style.left/top/etc so we
// don't fight CSS transforms in the upcoming editor PR.

type Props = {
  elements: SlideElement[];
  viewportW?: number;
};

export function SlideCanvas({ elements, viewportW = 960 }: Props) {
  const scale = viewportW / CANVAS_W;
  const viewportH = CANVAS_H * scale;

  return (
    <div
      className="relative overflow-hidden border border-line bg-paper"
      style={{ width: viewportW, height: viewportH }}
    >
      {elements.map((el) => (
        <ElementView key={el.id} element={el} scale={scale} />
      ))}
    </div>
  );
}

function ElementView({
  element,
  scale,
}: {
  element: SlideElement;
  scale: number;
}) {
  const box: CSSProperties = {
    position: 'absolute',
    left: element.x * scale,
    top: element.y * scale,
    width: element.w * scale,
    height: element.h * scale,
  };

  if (element.type === 'rect') {
    const rectStyle: CSSProperties = {
      ...box,
      backgroundColor: element.fill ?? 'transparent',
      border: element.border ? `1px solid ${element.border}` : undefined,
      borderRadius: element.borderRadius
        ? element.borderRadius * scale
        : undefined,
    };
    return (
      <div style={rectStyle}>
        {element.borderLeft ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: element.borderLeft.width * scale,
              backgroundColor: element.borderLeft.color,
            }}
          />
        ) : null}
      </div>
    );
  }

  const justify =
    element.align === 'center'
      ? 'center'
      : element.align === 'right'
        ? 'flex-end'
        : 'flex-start';
  const align =
    element.valign === 'middle'
      ? 'center'
      : element.valign === 'bottom'
        ? 'flex-end'
        : 'flex-start';

  const textStyle: CSSProperties = {
    ...box,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: align,
    alignItems: justify,
    color: element.color ?? THEME.ink,
    fontSize: element.fontSize * scale,
    fontWeight: element.fontWeight === 'bold' ? 700 : 400,
    lineHeight: element.lineHeight,
    whiteSpace: 'pre-wrap',
    textAlign: element.align,
    overflow: 'hidden',
  };

  return (
    <div style={textStyle}>
      <span style={{ width: '100%' }}>{element.content}</span>
    </div>
  );
}
