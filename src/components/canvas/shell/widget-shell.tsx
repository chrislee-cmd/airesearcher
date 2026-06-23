'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   대시보드 전용 (현재 유일 사용 경로):
   - 항상 expanded. collapse 없음.
   - 헤더 (썸네일 + 라벨 + pill + cost) — drag handle (parent 가
     dragHandleProps 로 wire-up: 순서 변경 dnd).
   - 본문 영역 overflow-y-auto — 부모가 고정 height 부여.
   ──────────────────────────────────────────────────────────────────── */

import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import Image from 'next/image';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

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
  const pill = statePill(content.state);
  const isDraggable = !!dragHandleProps?.draggable;

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-md border border-amore bg-paper-soft shadow-bento"
      aria-expanded
    >
      <div
        className={`flex h-[116px] shrink-0 items-center gap-4 px-5 py-4 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
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
            <span className="truncate text-3xl font-semibold tracking-[-0.018em] text-ink-2">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && (
            <div className="mt-1 truncate text-sm text-mute">
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
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft">
        <ExpandedBody />
      </div>
    </div>
  );
}
