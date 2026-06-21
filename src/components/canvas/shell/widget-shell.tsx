'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸 (collapsed 88px / expanded).
   board 가 expanded 상태를 단일 관리 (1장만 펼침). 클릭 시 onExpand 로
   교체. 시각 패턴은 #347/#349 (transcript-studio / desk-research) 와
   일관 — 큰 제목 + 액센트 아이콘 박스 + 상태 pill + 비용.
   ──────────────────────────────────────────────────────────────────── */

import type { KeyboardEvent } from 'react';
import Image from 'next/image';
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
      {/* Card 헤더 — collapsed 일 때도 동일 (높이 88px). 썸네일/액센트 박스
          (48px) + 제목 (text-xl) + 부제 (line-clamp-1) + 상태 pill + 비용.
          시각 비중은 #349 desk-research 헤더와 일관. */}
      <div className="flex h-[88px] shrink-0 items-center gap-4 bg-amore-tint px-5 py-4">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-sm ${ACCENT_BG[content.meta.accent]}`}
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
      {expanded && (
        // border-t 만 — 패딩 / 섹션 구분은 ExpandedBody 가 책임. desk-research /
        // transcript-studio 패턴은 본문 안에 다중 sub-section + border-t 로
        // 분할되어 있어서 shell 측의 단일 padding 컨테이너와 충돌.
        <div className="border-t border-line-soft">
          <ExpandedBody />
        </div>
      )}
    </div>
  );
}
