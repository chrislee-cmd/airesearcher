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
      className="flex flex-col overflow-hidden border border-cyan-700 bg-[#161b22]"
      aria-expanded
    >
      {/* file tab — IDE 시안 헤더 */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-[#0d1117] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">▾</span>
          <span className="text-cyan-300">{content.meta.label}.tool</span>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <span>{typeof content.meta.cost === 'number' ? (content.meta.cost === 0 ? 'free' : `${content.meta.cost} cr`) : ''}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            aria-label="접기"
            className="px-1.5 text-gray-500 hover:text-cyan-300"
          >
            ✕
          </button>
        </div>
      </div>
      {/* Expanded 헤더 — IDE/dark 톤. 썸네일 + 라벨 + 부제 + state. */}
      <div className="flex h-[88px] shrink-0 items-center gap-4 px-5 py-4">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 border border-cyan-700 object-cover"
            style={{ borderRadius: 2 }}
          />
        ) : (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center border border-cyan-700 ${ACCENT_BG[content.meta.accent]}`}
            style={{ borderRadius: 2 }}
          >
            <span className="text-xl text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-medium text-gray-100">
              {content.meta.label}
            </span>
            <Pill {...pill} />
          </div>
          {content.meta.description && (
            <div className="mt-0.5 text-sm text-gray-500 line-clamp-1">
              <span className="text-gray-600">{'//'}</span> {content.meta.description}
            </div>
          )}
        </div>
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
      className="grid border-t border-gray-800"
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
    // aspect-square: canvas-board 가 절대 좌표로 카드 부모의 width 만 정함
    // (CARD_W_COLLAPSED). aspect-square 로 카드가 자기 width 에 맞춰 높이도
    // 정사각형으로 자동 계산. (이전 h-full 은 grid cell 의 explicit height
    // 가 있어야 동작 — 절대 좌표 layout 에서는 부모 height 가 minHeight 만
    // 이라 h-full 이 의도대로 안 됨).
    <div
      className="group flex aspect-square cursor-pointer flex-col overflow-hidden border border-gray-800 bg-[#161b22] transition-colors hover:border-cyan-700 hover:bg-[#1c2128]"
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-expanded={false}
    >
      {/* file tab — 미니 chrome */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-[#0d1117] px-2.5 py-1 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-purple-400">▸</span>
          <span className="text-cyan-300">{content.meta.label.replace(/\s+/g, '_').toLowerCase()}.tool</span>
        </div>
        {typeof content.meta.cost === 'number' && (
          <span className="text-yellow-300">
            {content.meta.cost === 0 ? 'free' : `${content.meta.cost}cr`}
          </span>
        )}
      </div>
      {/* 상단 — 썸네일. dark bg 위 floating image. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {content.meta.thumbnail ? (
          <Image
            src={content.meta.thumbnail}
            alt=""
            fill
            sizes="240px"
            className="object-cover opacity-95 group-hover:opacity-100"
          />
        ) : (
          <div
            className={`flex h-20 w-20 items-center justify-center border border-cyan-700 ${ACCENT_BG[content.meta.accent]}`}
            style={{ borderRadius: 2 }}
          >
            <span className="text-3xl text-ink">
              {ACCENT_ICON[content.meta.accent]}
            </span>
          </div>
        )}
      </div>
      {/* 하단 — label line + run hint */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-800 bg-[#161b22] px-3 py-2 text-xs">
        <span className="truncate text-gray-100">{content.meta.label}</span>
        <span className="shrink-0 text-cyan-400 group-hover:text-cyan-300">→</span>
      </div>
    </div>
  );
}
