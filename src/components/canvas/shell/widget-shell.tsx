'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (n8n 풍 node chrome).

   - 헤더 = drag handle. 클릭 = select. 더블클릭 / chevron = collapse 토글.
   - 좌/우 edge 중간에 작은 port dot (cosmetic — 후속 PR 에서 connection
     drag-create 의 anchor 가 됨).
   - collapsed 모드: 본문 숨김, 헤더만 (h=116 → 부모가 height 도 함께 조정).
   - 선택 상태 (isSelected) 일 때 amore outline + 살짝 더 진한 shadow.
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

  // header click = select (canvas-board 가 selection 처리)
  // header double-click = collapse toggle
  const headerOnClick = (e: ReactMouseEvent<HTMLElement>) => {
    // drag handle 인 경우 click 이지만 drag 종료 직후도 click 으로 잡힘 — OK.
    if (e.detail === 2 && onToggleCollapse) onToggleCollapse();
    else if (onSelect) onSelect();
  };

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-md bg-paper transition-shadow ${
        isSelected
          ? 'border-2 border-amore shadow-bento'
          : 'border border-line shadow-bento'
      }`}
      aria-expanded={!isCollapsed}
    >
      {/* port dot — left (input) */}
      <span
        aria-hidden
        className="absolute -left-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border border-line bg-paper"
        style={{ boxShadow: '0 0 0 2px var(--color-paper)' }}
      />
      {/* port dot — right (output) */}
      <span
        aria-hidden
        className="absolute -right-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border border-amore bg-amore-bg"
        style={{ boxShadow: '0 0 0 2px var(--color-paper)' }}
      />

      <div
        className={`flex shrink-0 items-center gap-3 px-4 py-3 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${isCollapsed ? '' : 'border-b border-line-soft'}`}
        {...dragHandleProps}
        onClick={headerOnClick}
        style={{ height: 64 }}
      >
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={36}
            height={36}
            draggable={false}
            className="h-9 w-9 shrink-0 rounded-xs border border-line object-cover"
          />
        ) : (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-line ${ACCENT_BG[content.meta.accent]}`}
          >
            <span className="text-base text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-md font-semibold tracking-[-0.005em] text-ink-2">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && !isCollapsed && (
            <div className="mt-0.5 truncate text-xs text-mute">
              {content.meta.description}
            </div>
          )}
        </div>
        {typeof content.meta.cost === 'number' && !isCollapsed && (
          <span className="shrink-0 text-xs text-mute-soft">
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ExpandedBody />
        </div>
      )}
    </div>
  );
}
