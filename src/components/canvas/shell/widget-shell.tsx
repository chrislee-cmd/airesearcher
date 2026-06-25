'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (n8n 풍 node chrome).

   - 헤더 = drag handle. 클릭 = select. 더블클릭 / chevron = collapse 토글.
   - 좌/우 edge 중간에 작은 port dot (모든 layout 공통).
   - collapsed 모드: 본문 숨김, 헤더만 (h=64).
   - 선택 상태 (isSelected) 일 때 outline 강조.

   theme 별 시그너처 (`classic` layout 에 full 적용):
     cyber  — 좌상단 LED status dot + `> ` mono prompt prefix
     glass  — thumbnail 자리에 mesh-gradient sphere
     swiss  — 큰 number prefix `01.` + 헤더 우측 굵은 검은 vertical bar
     sketch — label 밑 형광 노랑 squiggle underline (SVG)
     pop    — label 옆 검은 chip badge + thumbnail 자리에 굵은 색 chip

   widget layout 5 variant:
     classic       — 상단 헤더 + 본문 가득 (full theme 시그너처)
     banner-top    — 큰 컬러 hero 헤더 (label 크게) + 본문 60%
     banner-bottom — 본문 dominant + 하단 caption frame (Polaroid)
     sidebar       — 좌측 세로 strip + 우측 헤더 + 본문
     sticker       — 헤더 chrome 제거 + 카드 밖 떠 있는 라벨 + 살짝 기울기
   ──────────────────────────────────────────────────────────────────── */

import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import Image from 'next/image';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';
import { IconButton } from '@/components/ui/icon-button';
import type { CanvasTheme, WidgetLayout } from '@/lib/canvas/themes';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

type ShellProps = {
  content: WidgetContent;
  dashboardMode?: boolean;
  theme?: CanvasTheme;
  layout?: WidgetLayout;
  index?: number;
  dragHandleProps?: DragHandleProps;
  isCollapsed?: boolean;
  isSelected?: boolean;
  onToggleCollapse?: () => void;
  onSelect?: () => void;
};

export function WidgetShell(props: ShellProps) {
  const { layout = 'classic' } = props;
  switch (layout) {
    case 'banner-top':    return <BannerTopLayout {...props} />;
    case 'banner-bottom': return <BannerBottomLayout {...props} />;
    case 'sidebar':       return <SidebarLayout {...props} />;
    case 'sticker':       return <StickerLayout {...props} />;
    case 'classic':
    default:              return <ClassicLayout {...props} />;
  }
}

/* ────────────────────────────────────────────────────────────────────
   공용 helpers
   ──────────────────────────────────────────────────────────────────── */

function cardStyle(isSelected: boolean): React.CSSProperties {
  return {
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
}

function labelStyle(): React.CSSProperties {
  return {
    fontWeight: 'var(--canvas-card-header-weight)' as unknown as number,
    letterSpacing: 'var(--canvas-card-header-tracking)',
    textTransform: 'var(--canvas-card-header-transform)' as unknown as React.CSSProperties['textTransform'],
    color: 'var(--canvas-card-header-text)',
    fontFamily: 'var(--canvas-card-header-font)',
  };
}

const PORT_RING = '0 0 0 2px var(--canvas-port-ring)';

function Ports() {
  return (
    <>
      <span
        aria-hidden
        className="absolute -left-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
        style={{
          background: 'var(--canvas-port-in-bg)',
          border: '1px solid var(--canvas-port-in-border)',
          boxShadow: PORT_RING,
        }}
      />
      <span
        aria-hidden
        className="absolute -right-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full"
        style={{
          background: 'var(--canvas-port-out-bg)',
          border: '1px solid var(--canvas-port-out-border)',
          boxShadow: PORT_RING,
        }}
      />
    </>
  );
}

function CollapseButton({
  isCollapsed,
  onClick,
}: {
  isCollapsed: boolean;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <IconButton
      variant="ghost"
      size="sm"
      aria-label={isCollapsed ? '펼치기' : '접기'}
      title={isCollapsed ? '펼치기' : '접기'}
      onClick={onClick}
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
  );
}

// theme 별 icon slot — classic 에서만 full 적용
function ThemedIcon({ content, theme }: { content: WidgetContent; theme: CanvasTheme }) {
  if (theme === 'glass') {
    return (
      <div
        className="h-9 w-9 shrink-0 rounded-full"
        aria-hidden
        style={{
          background:
            'radial-gradient(circle at 30% 30%, #fff 0%, #c4b5fd 35%, #ec4899 70%, #fbbf24 100%)',
          boxShadow: 'inset 0 -2px 4px rgba(255,255,255,0.4), inset 0 2px 4px rgba(0,0,0,0.1)',
        }}
      />
    );
  }
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
  if (theme === 'sketch') {
    return (
      <div className="relative h-9 w-9 shrink-0">
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="absolute inset-0">
          <path
            d="M 18 3 C 26 3, 33 9, 33 18 C 32 27, 26 33, 18 33 C 9 32, 3 26, 3 18 C 4 10, 10 4, 18 3 Z"
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
}

function StatePill({ content, theme }: { content: WidgetContent; theme: CanvasTheme }) {
  if (theme === 'pop') {
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
        {content.state === 'running' ? 'LIVE' : content.state === 'done' ? 'DONE' : 'READY'}
      </span>
    );
  }
  if (theme === 'cyber') {
    return (
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
    );
  }
  return <Pill {...statePill(content.state)} />;
}

function makeHeaderClickHandlers({
  onSelect,
  onToggleCollapse,
}: {
  onSelect?: () => void;
  onToggleCollapse?: () => void;
}) {
  return (e: ReactMouseEvent<HTMLElement>) => {
    if (e.detail === 2 && onToggleCollapse) onToggleCollapse();
    else if (onSelect) onSelect();
  };
}

function CostText({ content }: { content: WidgetContent }) {
  if (typeof content.meta.cost !== 'number') return null;
  return (
    <span className="shrink-0 text-xs" style={{ color: 'var(--canvas-card-mute)' }}>
      {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
    </span>
  );
}

function BodyArea({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Layout 1 — Classic (현재) — full theme 시그너처 활성
   ──────────────────────────────────────────────────────────────────── */
function ClassicLayout({
  content,
  theme = 'default',
  index = 1,
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: ShellProps) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const headerClick = makeHeaderClickHandlers({ onSelect, onToggleCollapse });

  const renderLabel = () => {
    const base = (
      <span className="truncate text-md" style={labelStyle()}>
        {theme === 'cyber' && <span style={{ opacity: 0.7, marginRight: 4 }}>{'>'}</span>}
        {theme === 'swiss' && (
          <span style={{ fontWeight: 800, opacity: 0.55, marginRight: 10, fontVariantNumeric: 'tabular-nums' }}>
            {String(index).padStart(2, '0')}.
          </span>
        )}
        {content.meta.label}
      </span>
    );
    if (theme === 'sketch') {
      return (
        <span className="relative inline-flex">
          {base}
          <svg width="100%" height="6" viewBox="0 0 200 6" preserveAspectRatio="none" aria-hidden className="absolute -bottom-1 left-0 right-0">
            <path d="M 0 3 Q 25 1, 50 3 T 100 3 T 150 3 T 200 3" fill="none" stroke="#fff176" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          </svg>
        </span>
      );
    }
    return base;
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden" aria-expanded={!isCollapsed} style={cardStyle(isSelected)}>
      <Ports />
      <div
        className={`flex shrink-0 items-center gap-3 px-4 py-3 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        {...dragHandleProps}
        onClick={headerClick}
        style={{
          height: 64,
          background: 'var(--canvas-card-header-bg)',
          color: 'var(--canvas-card-header-text)',
          fontFamily: 'var(--canvas-card-header-font)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--canvas-card-header-divider)',
        }}
      >
        <ThemedIcon content={content} theme={theme} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {renderLabel()}
            <StatePill content={content} theme={theme} />
          </div>
          {content.meta.description && !isCollapsed && (
            <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--canvas-card-mute)' }}>
              {content.meta.description}
            </div>
          )}
        </div>
        {!isCollapsed && <CostText content={content} />}
        {theme === 'swiss' && <span aria-hidden className="shrink-0" style={{ width: 3, height: 40, background: '#000' }} />}
        {onToggleCollapse && (
          <CollapseButton isCollapsed={isCollapsed} onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} />
        )}
      </div>
      {!isCollapsed && <BodyArea><ExpandedBody /></BodyArea>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Layout 2 — Banner-top — 큰 컬러 hero 헤더 (140px) + 본문
   ──────────────────────────────────────────────────────────────────── */
function BannerTopLayout({
  content,
  theme = 'default',
  index = 1,
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: ShellProps) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const headerClick = makeHeaderClickHandlers({ onSelect, onToggleCollapse });
  const BANNER_H = isCollapsed ? 64 : 140;

  // banner 의 배경은 theme accent (--canvas-accent) 가 dominant 하게.
  // pop 에서는 노란 chip 헤더 색을 banner 전체에 확장.
  const bannerBg = theme === 'pop'
    ? '#ffd53d'
    : theme === 'sketch'
    ? '#fff7d6'
    : 'var(--canvas-accent)';
  const bannerText = theme === 'pop' || theme === 'sketch'
    ? '#000'
    : '#fff';

  return (
    <div className="relative flex h-full flex-col overflow-hidden" aria-expanded={!isCollapsed} style={cardStyle(isSelected)}>
      <Ports />
      <div
        className={`flex shrink-0 flex-col justify-end gap-1 px-5 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        {...dragHandleProps}
        onClick={headerClick}
        style={{
          height: BANNER_H,
          paddingBottom: 16,
          paddingTop: 16,
          background: bannerBg,
          color: bannerText,
          fontFamily: 'var(--canvas-card-header-font)',
          borderBottom: theme === 'pop' || theme === 'swiss' ? '3px solid #000' : '1px solid var(--canvas-card-header-divider)',
        }}
      >
        <div className="flex items-center gap-2 text-xs uppercase opacity-80">
          {theme === 'swiss' && (
            <span style={{ fontWeight: 800, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
              {String(index).padStart(2, '0')}
            </span>
          )}
          <span>{content.meta.cost === 0 ? '무료' : `${content.meta.cost ?? 0} 크레딧`}</span>
          <span className="ml-auto flex items-center gap-2">
            <StatePill content={content} theme={theme} />
            {onToggleCollapse && (
              <CollapseButton isCollapsed={isCollapsed} onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} />
            )}
          </span>
        </div>
        <div
          className="truncate"
          style={{
            ...labelStyle(),
            color: bannerText,
            fontSize: isCollapsed ? 18 : 32,
            lineHeight: 1.05,
          }}
        >
          {content.meta.label}
        </div>
        {!isCollapsed && content.meta.description && (
          <div className="truncate text-sm opacity-80" style={{ color: bannerText }}>
            {content.meta.description}
          </div>
        )}
      </div>
      {!isCollapsed && <BodyArea><ExpandedBody /></BodyArea>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Layout 3 — Banner-bottom (Polaroid) — 본문 위 + 하단 caption frame
   ──────────────────────────────────────────────────────────────────── */
function BannerBottomLayout({
  content,
  theme = 'default',
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: ShellProps) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const headerClick = makeHeaderClickHandlers({ onSelect, onToggleCollapse });
  const CAPTION_H = 88;
  const captionBg = theme === 'pop' ? '#fff' : 'var(--canvas-card-bg)';

  return (
    <div className="relative flex h-full flex-col overflow-hidden" aria-expanded={!isCollapsed} style={cardStyle(isSelected)}>
      <Ports />
      {/* drag handle: 위쪽 thin grip strip — 카드 상단에 visible 한 작은 핸들 */}
      <div
        className={`absolute left-1/2 top-2 -translate-x-1/2 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        {...dragHandleProps}
        onClick={headerClick}
        style={{
          width: 48,
          height: 4,
          borderRadius: 2,
          background: 'var(--canvas-card-mute)',
          opacity: 0.4,
          zIndex: 2,
        }}
        aria-label="drag handle"
      />
      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-paper" style={{ paddingTop: 8 }}>
          <ExpandedBody />
        </div>
      )}
      {/* caption frame — 하단, 라벨/cost/chevron */}
      <div
        className="flex shrink-0 items-center gap-3 px-4"
        onClick={headerClick}
        style={{
          height: isCollapsed ? 64 : CAPTION_H,
          background: captionBg,
          color: 'var(--canvas-card-header-text)',
          fontFamily: 'var(--canvas-card-header-font)',
          borderTop: '1px solid var(--canvas-card-header-divider)',
        }}
      >
        <ThemedIcon content={content} theme={theme} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-md" style={labelStyle()}>{content.meta.label}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: 'var(--canvas-card-mute)' }}>
            {content.meta.cost === 0 ? '무료' : `${content.meta.cost ?? 0} 크레딧`}
            <StatePill content={content} theme={theme} />
          </div>
        </div>
        {onToggleCollapse && (
          <CollapseButton isCollapsed={isCollapsed} onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Layout 4 — Sidebar — 좌측 80px 세로 strip + 우측 헤더 + 본문
   ──────────────────────────────────────────────────────────────────── */
function SidebarLayout({
  content,
  theme = 'default',
  index = 1,
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: ShellProps) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const headerClick = makeHeaderClickHandlers({ onSelect, onToggleCollapse });
  const SIDEBAR_W = 80;

  const stripBg = theme === 'pop'
    ? '#ffd53d'
    : theme === 'sketch'
    ? '#fff7d6'
    : 'var(--canvas-card-header-bg)';
  const stripText = theme === 'pop' || theme === 'sketch'
    ? '#000'
    : 'var(--canvas-card-header-text)';

  return (
    <div className="relative flex h-full overflow-hidden" aria-expanded={!isCollapsed} style={cardStyle(isSelected)}>
      <Ports />
      {/* 좌측 strip — icon + state + vertical 텍스트 */}
      <div
        className="flex shrink-0 flex-col items-center justify-between py-4"
        style={{
          width: SIDEBAR_W,
          background: stripBg,
          borderRight: theme === 'pop' || theme === 'swiss' ? '3px solid #000' : '1px solid var(--canvas-card-header-divider)',
          color: stripText,
          fontFamily: 'var(--canvas-card-header-font)',
        }}
      >
        <ThemedIcon content={content} theme={theme} />
        <div
          className="flex-1 flex items-center justify-center text-xs uppercase tracking-widest"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: stripText, opacity: 0.7 }}
        >
          {theme === 'swiss' ? `${String(index).padStart(2, '0')} · ${content.state}` : content.state}
        </div>
        <div className="text-xs font-semibold" style={{ color: stripText }}>
          {content.meta.cost === 0 ? '무료' : `${content.meta.cost ?? 0}`}
        </div>
      </div>
      {/* 우측 영역 — 헤더 + 본문 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={`flex shrink-0 items-center gap-2 px-4 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
          {...dragHandleProps}
          onClick={headerClick}
          style={{
            height: 48,
            background: 'var(--canvas-card-bg)',
            color: 'var(--canvas-card-header-text)',
            fontFamily: 'var(--canvas-card-header-font)',
            borderBottom: isCollapsed ? 'none' : '1px solid var(--canvas-card-header-divider)',
          }}
        >
          <div className="min-w-0 flex-1 truncate text-md" style={labelStyle()}>{content.meta.label}</div>
          <StatePill content={content} theme={theme} />
          {onToggleCollapse && (
            <CollapseButton isCollapsed={isCollapsed} onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} />
          )}
        </div>
        {!isCollapsed && <BodyArea><ExpandedBody /></BodyArea>}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Layout 5 — Sticker — 헤더 chrome 제거 + 카드 밖 떠 있는 라벨 + 기울기
   ──────────────────────────────────────────────────────────────────── */
function StickerLayout({
  content,
  theme = 'default',
  dragHandleProps,
  isCollapsed = false,
  isSelected = false,
  onToggleCollapse,
  onSelect,
}: ShellProps) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const headerClick = makeHeaderClickHandlers({ onSelect, onToggleCollapse });

  // sticker = 카드 본체와 분리된 작은 라벨 패널. 카드 위로 살짝 튀어나옴
  // (top: -18px). 카드는 -1deg 회전.
  return (
    <div
      className="relative h-full"
      style={{
        // 카드 본체 회전. sticker 는 본체 위에 있으므로 같이 회전 → 함께 기울어짐
        transform: 'rotate(-1deg)',
        transformOrigin: 'center top',
        overflow: 'visible',
      }}
    >
      <div
        className="relative flex h-full flex-col overflow-hidden"
        aria-expanded={!isCollapsed}
        style={cardStyle(isSelected)}
      >
        <Ports />
        {!isCollapsed && <BodyArea><ExpandedBody /></BodyArea>}
        {isCollapsed && (
          <div
            className={`flex h-full items-center justify-center px-4 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
            {...dragHandleProps}
            onClick={headerClick}
            style={{ color: 'var(--canvas-card-mute)', fontFamily: 'var(--canvas-card-header-font)' }}
          >
            <span className="text-md" style={labelStyle()}>{content.meta.label}</span>
          </div>
        )}
      </div>
      {/* sticker label — 카드 상단 좌측 위쪽으로 튀어나옴 */}
      <div
        className={`absolute -top-5 left-6 z-10 flex items-center gap-2 px-3 py-2 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        {...dragHandleProps}
        onClick={headerClick}
        style={{
          background: theme === 'pop' ? '#ffd53d' : 'var(--canvas-card-header-bg)',
          color: theme === 'pop' ? '#000' : 'var(--canvas-card-header-text)',
          fontFamily: 'var(--canvas-card-header-font)',
          border: theme === 'pop' ? '2.5px solid #000' : '1px solid var(--canvas-card-border)',
          borderRadius: theme === 'pop' ? 10 : 'var(--canvas-card-radius)',
          boxShadow: theme === 'pop'
            ? '3px 3px 0 #000'
            : 'var(--canvas-chrome-shadow)',
          transform: 'rotate(2deg)', // sticker 자체는 카드 회전 반대로 살짝 — paper sticker 느낌
        }}
      >
        <span className="truncate text-md" style={labelStyle()}>{content.meta.label}</span>
        <StatePill content={content} theme={theme} />
        {onToggleCollapse && (
          <CollapseButton isCollapsed={isCollapsed} onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }} />
        )}
      </div>
      {/* cost 작은 chip — 우상단 corner sticker */}
      {typeof content.meta.cost === 'number' && (
        <div
          className="absolute -top-3 right-4 z-10 px-2 py-1 text-xs"
          style={{
            background: 'var(--canvas-card-bg)',
            color: 'var(--canvas-card-mute)',
            border: '1px solid var(--canvas-card-border)',
            borderRadius: 4,
            transform: 'rotate(-2deg)',
          }}
        >
          {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
        </div>
      )}
    </div>
  );
}
