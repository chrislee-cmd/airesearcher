'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   - collapsed: 정사각형 (aspect-square) + 세로 stack 레이아웃 (썸네일 ↑ /
     라벨 · 부제 / pill · cost ↓). 클릭 어디든 expand, drag 도 어디든 가능
     (parent 가 dragHandleProps 로 wire-up).
   - expanded: 가로 헤더 (썸네일 + 라벨 + 부제 + pill + cost) + 본문.
     헤더 클릭 = collapse (✕ 버튼 제거), 헤더 어디든 drag handle.

   board 가 expanded state Set 으로 관리 (B-2 multi-expand). 클릭 → onExpand
   / onCollapse 토글.
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';

// 부모(canvas-board) 가 위치 변경 dnd 를 wire-up 하는 prop 묶음. collapsed
// 일 때는 tile 전체, expanded 일 때는 헤더 영역에 spread.
export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

export function WidgetShell({
  content,
  expanded,
  onExpand,
  onCollapse,
  dragHandleProps,
}: {
  content: WidgetContent;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  dragHandleProps?: DragHandleProps;
}) {
  const { ExpandedBody } = content;
  const pill = statePill(content.state);

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!expanded && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onExpand();
    }
  }

  if (!expanded) {
    return (
      <CollapsedTile
        content={content}
        onExpand={onExpand}
        onKeyDown={handleKey}
        dragHandleProps={dragHandleProps}
      />
    );
  }

  return (
    // 자연 높이로 자라남. 본문 내부 스크롤 X — 캔버스 자체가 pan/zoom 으로
    // navigable.
    <div
      className="flex flex-col overflow-hidden rounded-md border border-amore bg-paper-soft shadow-bento"
      aria-expanded
    >
      {/* Expanded 헤더 — 클릭 어디든 collapse, drag 어디든 reposition. */}
      <div
        className="flex h-[88px] shrink-0 cursor-grab items-center gap-4 px-5 py-4 active:cursor-grabbing"
        onClick={onCollapse}
        role="button"
        aria-label="접기"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onCollapse();
          }
        }}
        {...dragHandleProps}
      >
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={48}
            height={48}
            draggable={false}
            className="h-12 w-12 shrink-0 rounded-sm border border-amore-tint object-cover"
          />
        ) : (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-amore-tint ${ACCENT_BG[content.meta.accent]}`}
          >
            <span className="text-xl text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-medium text-ink-2">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && (
            <div className="mt-0.5 text-sm text-mute line-clamp-1">
              {content.meta.description}
            </div>
          )}
        </div>
        {typeof content.meta.cost === 'number' && (
          <span className="shrink-0 text-xs text-mute-soft">
            {content.meta.cost === 0
              ? '무료'
              : `${content.meta.cost} 크레딧`}
          </span>
        )}
      </div>
      {/* Notion 토글식 open animation — grid-template-rows: 0fr → 1fr
          보간으로 본문이 부드럽게 펼쳐짐. */}
      <ExpandableBody>
        <ExpandedBody />
      </ExpandableBody>
    </div>
  );
}

function ExpandableBody({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className="grid border-t border-line-soft"
      style={{
        gridTemplateRows: isOpen ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

// Collapsed 모드 — 썸네일 + 라벨/cost compact bar. 전체 tile 이 클릭 → expand
// 이자 drag handle. 클릭 vs 드래그는 native dnd 가 mousedown + move 임계로
// 분리 — 짧은 클릭은 onClick, 누른 채 이동은 dragstart.
function CollapsedTile({
  content,
  onExpand,
  onKeyDown,
  dragHandleProps,
}: {
  content: WidgetContent;
  onExpand: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  dragHandleProps?: DragHandleProps;
}) {
  return (
    <div
      className="flex aspect-square cursor-grab flex-col overflow-hidden rounded-md border border-line bg-paper-soft shadow-bento transition-all hover:border-ink active:cursor-grabbing"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-expanded={false}
      {...dragHandleProps}
    >
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            fill
            sizes="240px"
            draggable={false}
            className="object-cover"
          />
        ) : (
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-sm border border-amore-tint ${ACCENT_BG[content.meta.accent]}`}
          >
            <span className="text-3xl text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft bg-paper-soft px-3 py-2">
        <span className="truncate text-sm font-semibold text-ink-2">
          {content.meta.label}
        </span>
        {typeof content.meta.cost === 'number' && (
          <span className="shrink-0 text-xs text-mute-soft">
            {content.meta.cost === 0 ? '무료' : `${content.meta.cost}`}
          </span>
        )}
      </div>
    </div>
  );
}
