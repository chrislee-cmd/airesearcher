'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (collapsed 88px / expanded).
   board 가 expanded 상태를 단일 관리 (1장만 펼침). 클릭 시 onExpand 로
   교체. 시각 패턴은 #347/#349 (transcript-studio / desk-research) 와
   일관 — 큰 제목 + 액센트 아이콘 박스 + 상태 pill + 비용.
   ──────────────────────────────────────────────────────────────────── */

import type { KeyboardEvent } from 'react';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';

export function WidgetShell({
  content,
  expanded,
  onExpand,
}: {
  content: WidgetContent;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { ExpandedBody } = content;
  const pill = statePill(content.state);

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!expanded && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onExpand();
    }
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-md border bg-paper-soft shadow-bento transition-all ${
        expanded
          ? 'border-amore'
          : 'cursor-pointer border-line hover:border-ink'
      }`}
      onClick={expanded ? undefined : onExpand}
      role={expanded ? undefined : 'button'}
      tabIndex={expanded ? undefined : 0}
      onKeyDown={handleKey}
      aria-expanded={expanded}
    >
      {/* Card 헤더 — collapsed 일 때도 동일 (높이 88px). 액센트 박스 +
          제목 + 상태 pill + 비용. 시각 비중은 #347 quotes 헤더와 동일. */}
      <div className="flex h-[88px] shrink-0 items-center gap-4 bg-amore-tint px-5 py-5">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-sm ${ACCENT_BG[content.meta.accent]}`}
        >
          <span className="text-2xl text-ink">
            {ACCENT_ICON[content.meta.accent]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl font-semibold tracking-tight text-ink-2">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
        </div>
        {typeof content.meta.cost === 'number' && (
          <span className="shrink-0 text-sm text-mute">
            {content.meta.cost === 0
              ? '무료'
              : `${content.meta.cost} 크레딧`}
          </span>
        )}
      </div>
      {expanded && (
        <div className="border-t border-line-soft px-5 py-5">
          <ExpandedBody />
        </div>
      )}
    </div>
  );
}
