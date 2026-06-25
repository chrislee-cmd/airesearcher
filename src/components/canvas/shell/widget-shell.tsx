'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (n8n 풍 node chrome).

   - 헤더 = drag handle. 클릭 = select. 더블클릭 / chevron = collapse 토글.
   - 좌/우 edge 중간에 작은 port dot (cosmetic — 후속 PR 에서 connection
     drag-create 의 anchor 가 됨).
   - collapsed 모드: 본문 숨김, 헤더만 (h=64 → 부모가 height 도 함께 조정).
   - 선택 상태 (isSelected) 일 때 outline 강조.

   theme: --canvas-card-* / --canvas-port-* / --canvas-selection-* CSS
   variables 사용. /canvas 의 data-canvas-theme 컨테이너 안에서 override.
   ──────────────────────────────────────────────────────────────────── */

import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import Image from 'next/image';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';
import { IconButton } from '@/components/ui/icon-button';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

export function WidgetShell({
  content,
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: {
  content: WidgetContent;
  dashboardMode?: boolean;
  dragHandleProps?: DragHandleProps;
  isCollapsed?: boolean;
  isSelected?: boolean;
  onToggleCollapse?: () => void;
  onSelect?: () => void;
}) {
  const { ExpandedBody } = content;
  const pill = statePill(content.state);
  const isDraggable = !!dragHandleProps?.draggable;

  // header click = select. double-click = collapse toggle.
  const headerOnClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.detail === 2 && onToggleCollapse) onToggleCollapse();
    else if (onSelect) onSelect();
  };

  // theme-aware container styles. border 와 outline (selection) 둘 다 같이
  // 그리기 위해 outline 사용 — border-width 가 theme 마다 다른데 그대로 유지.
  const cardStyle: React.CSSProperties = {
    background: 'var(--canvas-card-bg)',
    border: 'var(--canvas-card-border-width) var(--canvas-card-border-style) var(--canvas-card-border)',
    borderRadius: 'var(--canvas-card-radius)',
    boxShadow: 'var(--canvas-card-shadow)',
    backdropFilter: 'var(--canvas-backdrop)',
    WebkitBackdropFilter: 'var(--canvas-backdrop)' as unknown as string,
    outline: isSelected
      ? 'var(--canvas-selection-width) solid var(--canvas-selection-border)'
      : 'none',
    outlineOffset: isSelected ? '2px' : '0',
    transition: 'outline-color 0.12s, outline-width 0.12s, box-shadow 0.18s',
  };

  const headerStyle: React.CSSProperties = {
    height: 64,
    background: 'var(--canvas-card-header-bg)',
    color: 'var(--canvas-card-header-text)',
    fontFamily: 'var(--canvas-card-header-font)',
    borderBottom: isCollapsed
      ? 'none'
      : '1px solid var(--canvas-card-header-divider)',
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 'var(--canvas-card-header-weight)' as unknown as number,
    letterSpacing: 'var(--canvas-card-header-tracking)',
    textTransform: 'var(--canvas-card-header-transform)' as unknown as React.CSSProperties['textTransform'],
    color: 'var(--canvas-card-header-text)',
  };

  const portRing = '0 0 0 2px var(--canvas-port-ring)';

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      aria-expanded={!isCollapsed}
      style={cardStyle}
    >
      {/* port dot — left (input) */}
      <span
        aria-hidden
        className="absolute -left-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
        style={{
          background: 'var(--canvas-port-in-bg)',
          border: '1px solid var(--canvas-port-in-border)',
          boxShadow: portRing,
        }}
      />
      {/* port dot — right (output) */}
      <span
        aria-hidden
        className="absolute -right-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
        style={{
          background: 'var(--canvas-port-out-bg)',
          border: '1px solid var(--canvas-port-out-border)',
          boxShadow: portRing,
        }}
      />

      <div
        className={`flex shrink-0 items-center gap-3 px-4 py-3 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        {...dragHandleProps}
        onClick={headerOnClick}
        style={headerStyle}
      >
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={36}
            height={36}
            draggable={false}
            className="h-9 w-9 shrink-0 rounded-xs object-cover"
            style={{ border: '1px solid var(--canvas-card-border)' }}
          />
        ) : (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xs ${ACCENT_BG[content.meta.accent]}`}
            style={{ border: '1px solid var(--canvas-card-border)' }}
          >
            <span className="text-base text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-md" style={labelStyle}>
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && !isCollapsed && (
            <div
              className="mt-0.5 truncate text-xs"
              style={{ color: 'var(--canvas-card-mute)' }}
            >
              {content.meta.description}
            </div>
          )}
        </div>
        {typeof content.meta.cost === 'number' && !isCollapsed && (
          <span
            className="shrink-0 text-xs"
            style={{ color: 'var(--canvas-card-mute)' }}
          >
            {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
          </span>
        )}
        {onToggleCollapse && (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={isCollapsed ? '펼치기' : '접기'}
            title={isCollapsed ? '펼치기' : '접기'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            className="shrink-0"
            style={{ color: 'var(--canvas-card-header-text)' }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </IconButton>
        )}
      </div>
      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
          <ExpandedBody />
        </div>
      )}
    </div>
  );
}
