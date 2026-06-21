'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   - collapsed: 정사각형 (aspect-square) + 세로 stack 레이아웃 (썸네일 ↑ /
     라벨 · 부제 / pill · cost ↓). 3-col 그리드 셀에 fit.
   - expanded: 가로 헤더 (썸네일 + 라벨 + 부제 + pill + cost) + 본문.
     canvas-board 가 col-span-3 으로 풀폭 row 차지.

   board 가 expanded state 단일 관리 (B-2: 1장만 펼침). 클릭 → onExpand
   → 직전 expanded auto-collapse.
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

  if (!expanded) {
    return <CollapsedTile content={content} onExpand={onExpand} onKeyDown={handleKey} pill={pill} />;
  }

  return (
    // h-full + flex-col: 부모 (canvas-board 의 col-span-2 row-span-2 셀) 의
    // 높이 전체를 채우고, 헤더(88px 고정) 외 영역은 body 가 flex-1 +
    // overflow-y-auto 로 내부 스크롤. 본문(desk/quotes) 이 셀 높이를 넘기면
    // 카드 안에서만 스크롤되어 그리드 layout 깨지지 않음.
    <div
      className="flex h-full flex-col overflow-hidden rounded-md border border-amore bg-paper-soft shadow-bento transition-all"
      aria-expanded
    >
      {/* Expanded 헤더 — 가로 형태. desk-research / transcript-studio 의
          PR #349/#347 패턴과 시각 일관. */}
      <div className="flex h-[88px] shrink-0 items-center gap-4 px-5 py-4">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={48}
            height={48}
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
      {/* flex-1 overflow-y-auto: 헤더 외 영역 채우면서 본문 overflow 시
          카드 내부 스크롤. desk / transcript 본문은 다중 sub-section +
          border-t 로 분할 — shell 측 단일 padding 추가 없이 그대로 렌더. */}
      <div className="flex-1 overflow-y-auto border-t border-line-soft">
        <ExpandedBody />
      </div>
    </div>
  );
}

// Collapsed 모드 — 정사각형 그리드 셀. 썸네일/액센트 박스가 top 절반,
// 텍스트 영역이 bottom 절반. flex-col 로 라벨↑·부제→pill/cost 분할.
function CollapsedTile({
  content,
  onExpand,
  onKeyDown,
  pill,
}: {
  content: WidgetContent;
  onExpand: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  pill: { label: string; cls: string };
}) {
  return (
    // h-full: canvas-board 의 gridAutoRows 360px 가 셀 높이를 정함. card 가
    // 셀 높이 전체를 채우게 h-full (aspect-square 대신 — explicit grid row
    // height 와 충돌 방지).
    <div
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-md border border-line bg-paper-soft shadow-bento transition-all hover:border-ink"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-expanded={false}
    >
      {/* 상단 — 썸네일/액센트 박스. 카드 폭에 비례해 큰 시각 비중. */}
      <div className="flex flex-1 items-center justify-center">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={96}
            height={96}
            className="h-24 w-24 rounded-sm border border-amore-tint object-cover"
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
      {/* 하단 — 라벨 + 부제 + (pill · cost) bottom row. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line-soft bg-paper-soft px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-md font-semibold text-ink-2">
            {content.meta.label}
          </span>
          <Pill {...pill} />
        </div>
        {content.meta.description && (
          <div className="text-xs text-mute line-clamp-2">
            {content.meta.description}
          </div>
        )}
        {typeof content.meta.cost === 'number' && (
          <div className="text-xs text-mute-soft">
            {content.meta.cost === 0 ? '무료' : `${content.meta.cost} 크레딧`}
          </div>
        )}
      </div>
    </div>
  );
}
