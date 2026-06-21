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

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import Image from 'next/image';
import type { WidgetContent } from '../widget-types';
import { ACCENT_BG, ACCENT_ICON, statePill } from './tokens';
import { Pill } from './primitives';
import { IconButton } from '@/components/ui/icon-button';

export function WidgetShell({
  content,
  expanded,
  onExpand,
  onCollapse,
}: {
  content: WidgetContent;
  expanded: boolean;
  onExpand: () => void;
  // expanded 일 때 헤더의 접기 버튼이 호출. 모든 widget collapsed 도 가능
  // (canvas-board state 가 null 허용) — 클릭 시 setExpanded(null).
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
    return <CollapsedTile content={content} onExpand={onExpand} onKeyDown={handleKey} />;
  }

  return (
    // 자연 높이로 자라남 (h-full / row-span 제거 — canvas-board 에서 셀에
    // align-self start + z-10 으로 grid 밖으로 overflow 허용). 본문 내부
    // 스크롤 X — 캔버스 자체가 pan/zoom 으로 navigable.
    <div
      className="flex flex-col overflow-hidden rounded-md border border-amore bg-paper-soft shadow-bento"
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
        {/* 접기 버튼 — 클릭 시 widget 이 collapsed 상태로 (board state null
            허용). 본문 클릭과 분리되도록 헤더 우측에. */}
        <IconButton
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          aria-label="접기"
          className="ml-1 shrink-0"
        >
          ✕
        </IconButton>
      </div>
      {/* Notion 토글식 open animation — grid-template-rows: 0fr → 1fr
          보간으로 본문이 부드럽게 펼쳐짐. 본문 내부 스크롤 X — 자연 높이
          그대로 자라남. */}
      <ExpandableBody>
        <ExpandedBody />
      </ExpandableBody>
    </div>
  );
}

// CSS grid-template-rows 트릭으로 height 0 → auto 전환을 부드럽게 보간.
// 마운트 즉시 1프레임 0fr 로 렌더 후 RAF 로 1fr 토글 — 브라우저가 transition
// 을 거는 변화로 인식. 내부 wrapper 는 overflow-hidden + min-h-0 이어야
// 0fr 가 실제로 0 으로 collapsed.
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
