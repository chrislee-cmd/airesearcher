'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (n8n 풍 node chrome).

   - 헤더 = drag handle. 클릭 = select. 더블클릭 / chevron = collapse 토글.
   - 좌/우 edge 중간에 작은 port dot.
   - collapsed 모드: 본문 숨김, 헤더만 (h=64).
   - 선택 상태 (isSelected) 일 때 outline 강조.

   theme 별 헤더 variant — 같은 정보 (label / pill / cost) 를 다른 personality
   로 표현. 시그너처 요소를 1~2개 추가:
     cyber  — 좌상단 LED status dot + `> ` mono prompt prefix
     glass  — thumbnail 자리에 mesh-gradient sphere
     swiss  — 큰 number prefix `01.` + 헤더 우측 굵은 검은 vertical bar
     sketch — label 밑 형광 노랑 squiggle underline (SVG)
     pop    — label 옆 검은 chip badge + thumbnail 자리에 굵은 색 chip
     default — 현재 (Notion 베이스)
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
import type { CanvasTheme } from '@/lib/canvas/themes';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

export function WidgetShell({
  content,
  theme = 'default',
  index = 1,
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: {
  content: WidgetContent;
  dashboardMode?: boolean;
  theme?: CanvasTheme;
  index?: number; // swiss number prefix용 (1-based)
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
    borderBottom: isCollapsed ? 'none' : '1px solid var(--canvas-card-header-divider)',
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 'var(--canvas-card-header-weight)' as unknown as number,
    letterSpacing: 'var(--canvas-card-header-tracking)',
    textTransform: 'var(--canvas-card-header-transform)' as unknown as React.CSSProperties['textTransform'],
    color: 'var(--canvas-card-header-text)',
  };

  const portRing = '0 0 0 2px var(--canvas-port-ring)';

  // theme 별 thumbnail / icon slot 변형
  const renderIconSlot = () => {
    // glass: mesh-gradient sphere (thumbnail / accent icon 대체)
    if (theme === 'glass') {
      return (
        <div
          className="h-9 w-9 shrink-0 rounded-full"
          aria-hidden
          style={{
            background:
              'radial-gradient(circle at 30% 30%, #fff 0%, #c4b5fd 35%, #ec4899 70%, #fbbf24 100%)',
            boxShadow:
              'inset 0 -2px 4px rgba(255,255,255,0.4), inset 0 2px 4px rgba(0,0,0,0.1)',
          }}
        />
      );
    }
    // pop: 굵은 색 chip (위젯 accent 색 + 굵은 검은 border + offset shadow 작게)
    if (theme === 'pop') {
      return (
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center text-base ${ACCENT_BG[content.meta.accent]}`}
          aria-hidden
          style={{
            border: '2.5px solid #000',
            borderRadius: 6,
            color: '#000',
            boxShadow: '2px 2px 0 #000',
          }}
        >
          {ACCENT_ICON[content.meta.accent]}
        </div>
      );
    }
    // sketch: 손그림 동그라미 (SVG) 안에 emoji
    if (theme === 'sketch') {
      return (
        <div className="relative h-9 w-9 shrink-0">
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="absolute inset-0">
            <path
              d="M 18 3
                 C 26 3, 33 9, 33 18
                 C 32 27, 26 33, 18 33
                 C 9 32, 3 26, 3 18
                 C 4 10, 10 4, 18 3 Z"
              fill="#fffdf8"
              stroke="var(--canvas-card-header-text)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-base">
            {ACCENT_ICON[content.meta.accent]}
          </span>
        </div>
      );
    }
    // cyber: 작은 LED dot + mono accent (icon 자리 작아짐)
    if (theme === 'cyber') {
      const ledColor =
        content.state === 'running' ? '#00ff88'
        : content.state === 'error' ? '#ff5577'
        : content.state === 'done' ? '#00e0ff'
        : '#5a5a72';
      return (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: ledColor,
              boxShadow: `0 0 8px ${ledColor}`,
              animation: content.state === 'running' ? 'cyberLedPulse 1.2s ease-in-out infinite' : undefined,
            }}
          />
        </div>
      );
    }
    // default / swiss — 기존 thumbnail or accent icon
    return content.meta.thumbnail ? (
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
        <span className="text-base text-ink">{ACCENT_ICON[content.meta.accent]}</span>
      </div>
    );
  };

  // theme 별 label 변형 (prefix / underline / wrapper)
  const renderLabel = () => {
    const base = (
      <span className="truncate text-md" style={labelStyle}>
        {theme === 'cyber' && (
          <span style={{ opacity: 0.7, marginRight: 4 }}>{'>'}</span>
        )}
        {theme === 'swiss' && (
          <span
            style={{
              fontWeight: 800,
              opacity: 0.55,
              marginRight: 10,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {String(index).padStart(2, '0')}.
          </span>
        )}
        {content.meta.label}
      </span>
    );

    if (theme === 'sketch') {
      // 라벨 밑 형광 노랑 squiggle underline
      return (
        <span className="relative inline-flex">
          {base}
          <svg
            width="100%"
            height="6"
            viewBox="0 0 200 6"
            preserveAspectRatio="none"
            aria-hidden
            className="absolute -bottom-1 left-0 right-0"
          >
            <path
              d="M 0 3 Q 25 1, 50 3 T 100 3 T 150 3 T 200 3"
              fill="none"
              stroke="#fff176"
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.85"
            />
          </svg>
        </span>
      );
    }
    return base;
  };

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
        {renderIconSlot()}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {renderLabel()}
            {/* pop: 굵은 검은 chip badge 추가 (state 가시화) */}
            {theme === 'pop' ? (
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
                {content.state === 'running' ? 'LIVE' : content.state === 'done' ? 'DONE' : 'READY'}
              </span>
            ) : theme === 'cyber' ? (
              <span
                className="shrink-0 px-1.5 text-xs uppercase tracking-[0.12em]"
                style={{
                  color: 'var(--canvas-accent)',
                  border: '1px solid var(--canvas-accent)',
                  fontFamily: 'inherit',
                }}
              >
                [{content.state}]
              </span>
            ) : (
              <Pill {...pill} />
            )}
          </div>
          {content.meta.description && !isCollapsed && (
            <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--canvas-card-mute)' }}>
              {content.meta.description}
            </div>
          )}
        </div>
        {typeof content.meta.cost === 'number' && !isCollapsed && (
          <span
            className="shrink-0 text-xs"
            style={{
              color: 'var(--canvas-card-mute)',
              fontFamily: theme === 'cyber' ? 'inherit' : undefined,
            }}
          >
            {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
          </span>
        )}
        {/* swiss 시그너처: 우측 굵은 검은 vertical bar */}
        {theme === 'swiss' && (
          <span
            aria-hidden
            className="shrink-0"
            style={{ width: 3, height: 40, background: '#000' }}
          />
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
