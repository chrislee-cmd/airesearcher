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
    return <CollapsedTile content={content} onExpand={onExpand} onKeyDown={handleKey} />;
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

// Collapsed 모드 — compact 정사각형 (canvas-board gridAutoRows 240px).
// 썸네일이 카드 거의 가득 (fill object-cover), 하단에 라벨+cost 만 compact
// bar. state pill 은 expanded 헤더에만 노출 (collapsed 는 시각 노이즈 축소).
function CollapsedTile({
  content,
  onExpand,
  onKeyDown,
}: {
  content: WidgetContent;
  onExpand: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
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
      {/* 상단 — 썸네일/액센트 박스. `fill` + object-cover 로 카드 폭 가득.
          썸네일이 거의 가득 차게 보이도록 컨테이너 자체를 채움. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            fill
            sizes="240px"
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
      {/* 하단 — 라벨 + cost. compact (carrd 가 작아진 만큼 정보 핵심만). */}
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
