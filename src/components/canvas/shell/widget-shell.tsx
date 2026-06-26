'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   pop 잠금 디자인 (PR-D2 재정의) — banner-top + framed + display.
   - 카드 chrome: 흰 bg + 3px 검은 border + 14px radius + 6px offset shadow.
     (canvas pop 토큰 — globals.css @theme).
   - 헤더 (banner-top, 140px): 노랑 #ffd53d bg + 검은 3px bottom border +
     Outfit 폰트. 윗줄에 cost (좌) + state pill (우), 아래에 대형 32px label
     + description.
   - 본문 (framed): 2.5px 검은 inner border + inset shadow 액자 wrapper.
     data-canvas-body 부착 — Memphis bold + display typography scoped
     CSS rule 이 그 안의 button / input / 헤딩에 적용 (globals.css §canvas).
   - 헤더 영역 = drag handle (parent 가 dragHandleProps wire).
   ──────────────────────────────────────────────────────────────────── */

import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { WidgetContent, WidgetState } from '../widget-types';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

function popStatePillLabel(state: WidgetState): string {
  switch (state) {
    case 'running':
      return 'LIVE';
    case 'done':
      return 'DONE';
    case 'error':
      return 'ERR';
    case 'idle':
    default:
      return 'READY';
  }
}

function PopStatePill({ state }: { state: WidgetState }) {
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider"
      style={{
        background: '#fff',
        color: '#000',
        border: '2px solid #000',
        borderRadius: 4,
        boxShadow: '2px 2px 0 #000',
      }}
    >
      {popStatePillLabel(state)}
    </span>
  );
}

export function WidgetShell({
  content,
  dragHandleProps,
}: {
  content: WidgetContent;
  // 호출부 의도 표식 (현재는 default 동작).
  dashboardMode?: boolean;
  // 부모가 위젯 순서 변경 dnd 를 wire-up. 헤더 영역에 spread.
  dragHandleProps?: DragHandleProps;
}) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      aria-expanded
      style={{
        background: 'var(--canvas-card-bg)',
        border: 'var(--canvas-card-border-width) solid var(--canvas-card-border)',
        borderRadius: 'var(--canvas-card-radius)',
        boxShadow: 'var(--canvas-card-shadow)',
      }}
    >
      <div
        className={`flex shrink-0 flex-col justify-end gap-1 px-5 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        {...dragHandleProps}
        style={{
          height: 140,
          paddingTop: 16,
          paddingBottom: 16,
          background: 'var(--canvas-card-header-bg)',
          color: 'var(--canvas-card-header-text)',
          fontFamily: 'var(--font-outfit), var(--font-sans)',
          borderBottom: '3px solid var(--canvas-card-header-divider)',
        }}
      >
        <div className="flex items-center gap-2 text-xs uppercase opacity-80">
          <span>
            {typeof content.meta.cost === 'number'
              ? content.meta.cost === 0
                ? '무료'
                : `${content.meta.cost} 크레딧`
              : ''}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <PopStatePill state={content.state} />
          </span>
        </div>
        <div
          className="truncate"
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: 'var(--canvas-card-header-text)',
          }}
        >
          {content.meta.label}
        </div>
        {content.meta.description && (
          <div
            className="truncate text-sm opacity-80"
            style={{ color: 'var(--canvas-card-header-text)' }}
          >
            {content.meta.description}
          </div>
        )}
      </div>
      {/* framed body — 2.5px 검은 inner frame + inset shadow. 그 안쪽
          wrapper 가 data-canvas-body — globals.css 의 Memphis bold +
          display typography scoped rule 이 button / input / 헤딩에 적용. */}
      <div
        className="min-h-0 flex-1 overflow-hidden p-3"
        style={{ background: 'var(--canvas-card-bg)' }}
      >
        <div
          className="h-full overflow-y-auto"
          style={{
            border: '2.5px solid #000',
            borderRadius: 6,
            boxShadow:
              'inset 0 0 0 1px rgba(255, 255, 255, 0.6), inset 0 2px 6px rgba(0, 0, 0, 0.05)',
            background: 'var(--canvas-card-bg)',
          }}
        >
          <div data-canvas-body>
            <ExpandedBody />
          </div>
        </div>
      </div>
    </div>
  );
}
