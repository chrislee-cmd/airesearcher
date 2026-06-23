'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (Terminal/IDE 시안).

   - collapsed: 정사각형 + IDE 파일 탭 chrome (.tool 확장자) + 큰 monogram
     중앙 + 라벨 + cost
   - expanded: file tab + dark IDE 헤더 + monogram + 라벨 + 부제 + state
     pill + body slot

   .canvas-terminal scope 에서 디자인 토큰이 dark/neon 으로 override 되므로
   shell 은 토큰 기반 className 만 사용 — 안의 모든 ExpandedBody 도 자동
   dark.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { WidgetContent } from '../widget-types';
import { statePill } from './tokens';
import { Pill } from './primitives';

const MONOGRAM: Record<string, string> = {
  desk: 'DSK',
  quotes: 'QUO',
  moderator: 'MOD',
  translate: 'TRS',
  topline: 'TOP',
  slidegen: 'SLD',
  interviews: 'INT',
};
function monogram(key: string): string {
  return MONOGRAM[key] ?? key.slice(0, 3).toUpperCase();
}

export function WidgetShell({
  content,
  expanded,
  onExpand,
  onCollapse,
}: {
  content: WidgetContent;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
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
      />
    );
  }

  const costLabel =
    typeof content.meta.cost === 'number'
      ? content.meta.cost === 0
        ? 'free'
        : `${content.meta.cost} cr`
      : null;

  return (
    <div
      className="flex flex-col overflow-hidden border border-amore bg-paper-soft"
      aria-expanded
      style={{ borderRadius: 2 }}
    >
      {/* file tab */}
      <div
        className="flex items-center justify-between border-b border-line-soft bg-paper px-3 py-1.5 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="text-amore-soft">▾</span>
          <span className="text-amore">{content.meta.label}.tool</span>
        </div>
        <div className="flex items-center gap-2 text-mute-soft">
          {costLabel && <span className="text-warning">{costLabel}</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            aria-label="접기"
            className="px-1.5 text-mute hover:text-amore"
          >
            ✕
          </button>
        </div>
      </div>

      {/* main header — monogram + label + description + state pill */}
      <div className="flex h-[88px] shrink-0 items-center gap-4 px-5 py-4">
        <Monogram label={monogram(content.key)} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-medium text-ink-2">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && (
            <div className="mt-0.5 text-sm text-mute line-clamp-1">
              <span className="text-mute-soft">{'//'}</span>{' '}
              {content.meta.description}
            </div>
          )}
        </div>
      </div>

      <ExpandableBody>
        <ExpandedBody />
      </ExpandableBody>
    </div>
  );
}

// monogram letter box — 디자인 컨셉 (IDE/terminal) 에 맞는 식별자.
// 이미지 PNG 대신 3-letter cyan tag.
function Monogram({
  label,
  size,
}: {
  label: string;
  size: 'md' | 'xl';
}) {
  const cls =
    size === 'xl'
      ? 'h-24 w-24 text-2xl tracking-[0.18em]'
      : 'h-12 w-12 text-[11px] tracking-[0.14em]';
  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-amore-tint bg-amore-bg font-bold text-amore ${cls}`}
      style={{ borderRadius: 2 }}
    >
      {label}
    </div>
  );
}

// CSS grid-template-rows 트릭으로 height 0 → auto 전환 보간.
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

function CollapsedTile({
  content,
  onExpand,
  onKeyDown,
}: {
  content: WidgetContent;
  onExpand: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const costLabel =
    typeof content.meta.cost === 'number'
      ? content.meta.cost === 0
        ? 'free'
        : `${content.meta.cost}cr`
      : null;
  return (
    <div
      className="group flex aspect-square cursor-pointer flex-col overflow-hidden border border-line bg-paper-soft transition-colors hover:border-amore"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-expanded={false}
      style={{ borderRadius: 2 }}
    >
      {/* file tab — 미니 chrome */}
      <div className="flex shrink-0 items-center justify-between border-b border-line-soft bg-paper px-2.5 py-1 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-amore-soft">▸</span>
          <span className="text-amore">
            {content.key.replace(/_/g, '-')}.tool
          </span>
        </div>
        {costLabel && <span className="text-warning">{costLabel}</span>}
      </div>
      {/* 상단 — 큰 monogram 중앙 */}
      <div className="flex flex-1 items-center justify-center">
        <Monogram label={monogram(content.key)} size="xl" />
      </div>
      {/* 하단 — label + arrow */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft bg-paper-soft px-3 py-2 text-xs">
        <span className="truncate text-ink-2">{content.meta.label}</span>
        <span className="shrink-0 text-amore group-hover:text-amore-soft">
          →
        </span>
      </div>
    </div>
  );
}
