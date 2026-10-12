'use client';

/* ────────────────────────────────────────────────────────────────────
   팔레트의 body 포털 레이어 — 고스트 · 드래그 라벨 · 취소 안내 · 툴팁 ·
   접힘 작업 목록 팝오버.

   CD SSOT: `canvas-modular/full/README.md` §5(고스트·라벨·취소 안내) ·
   §4.1(접힘 툴팁·접힘 작업 목록) · §9(레이어).

   왜 전부 body 포털인가(스펙 제약 4): 팔레트는 캔버스 transform **밖**이고
   고스트는 **화면 px 고정**이라 줌과 무관해야 한다. 캔버스 안에 그리면 줌이
   고스트 크기를 바꾸고, 팔레트 안에 그리면 팔레트의 `overflow` 에 잘린다.
   `z-overlay` 는 캔버스의 click-to-focus 오버레이와 같은 층이지만 **뒤에
   렌더**되므로 DOM 순서로 이긴다 — 새 z 티어를 만들지 않는다(LEARNINGS §3-2).

   고스트는 **이벤트를 받지 않는다**(`pointer-events: none`). 판정은 document
   레벨 pointermove/pointerup 의 기하라서, 카드 포털의 합성 이벤트 버블 문제를
   겪지 않는다(§8-2).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { widgetIconFor } from '@/components/canvas/shell/widget-icon';
import { ACCENT_BG } from '@/components/canvas/shell/tokens';
import type { AccentColor } from '@/components/canvas/widget-types';
import { RETURN_MS } from './use-palette-drag';
import { TILE_W } from './palette-tile';

/**
 * SSR 안전 포털. `typeof window` 가드만으로 충분하다 — 이 포털들은 **사용자
 * 조작 이후에만** 마운트되므로(드래그·hover·펼침) 서버 렌더 시점에 존재하지
 * 않고 hydration 불일치가 생기지 않는다. `Modal` primitive 와 같은 가드다.
 */
function BodyPortal({ children }: { children: ReactNode }) {
  if (typeof window === 'undefined') return null;
  return createPortal(children, document.body);
}

/**
 * 끌고 있는 타일의 사본 (§5 고스트). 216×64 · rotate 2° · 집은 지점 오프셋
 * 유지 · `--sh-popover` 계열 그림자.
 */
export function PaletteGhost({
  x,
  y,
  returning,
  name,
  credits,
  accent,
  widgetKey,
  label,
}: {
  x: number;
  y: number;
  /** 취소 복귀 중 — 원본 자리로 200ms ease-in-out 이동한다. */
  returning: boolean;
  name: string;
  credits: string;
  accent: AccentColor;
  widgetKey: string;
  /** 고스트 옆 라벨 — "2단계"(ink) / "놓을 수 없음"(err). 없으면 null. */
  label: { text: string; valid: boolean } | null;
}) {
  return (
    <BodyPortal>
      <div
        data-palette-ghost={widgetKey}
        aria-hidden
        style={{
          left: x,
          top: y,
          width: TILE_W,
          height: 'var(--palette-tile-h)',
          gap: 11,
          padding: '0 10px',
          transform: returning ? undefined : 'rotate(2deg)',
          transition: returning
            ? `left ${RETURN_MS}ms ease-in-out, top ${RETURN_MS}ms ease-in-out, transform ${RETURN_MS}ms ease-in-out`
            : undefined,
          boxShadow: 'var(--sh-popover)',
        }}
        className="pointer-events-none fixed z-overlay flex items-center rounded-control border border-soft-line bg-soft-surface"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-icon ${ACCENT_BG[accent]}`}
        >
          <DuotoneIcon
            name={widgetIconFor(widgetKey)}
            size={20}
            fill="var(--color-paper)"
          />
        </span>
        <span style={{ gap: 3 }} className="flex min-w-0 flex-col">
          <span className="truncate text-lg font-semibold text-ink">{name}</span>
          <span className="font-soft-mono text-sm text-soft-mute">{credits}</span>
        </span>
      </div>
      {label && !returning && (
        <span
          data-palette-drag-label={label.valid ? 'valid' : 'invalid'}
          aria-live="polite"
          style={{
            left: x + TILE_W + 16,
            top: y + 56,
            padding: '4px 11px',
            boxShadow: 'var(--sh-popover)',
          }}
          className={`pointer-events-none fixed z-overlay inline-flex items-center rounded-pill text-md font-semibold whitespace-nowrap ${
            label.valid
              ? 'bg-ink text-soft-surface'
              : 'bg-soft-err-bg text-soft-err-fg'
          }`}
        >
          {label.text}
        </span>
      )}
    </BodyPortal>
  );
}

/**
 * 빈 작업면에 놓아 취소된 경우에만 1.6s (§5 취소 — 안내).
 * "체인 자리에 놓아야 들어가요" 한 줄. 다른 취소 경로에는 띄우지 않는다.
 */
export function PaletteEmptyDropHint({
  x,
  y,
  text,
}: {
  x: number;
  y: number;
  text: string;
}) {
  return (
    <BodyPortal>
      <div
        data-palette-empty-hint
        role="status"
        style={{
          left: x + 16,
          top: y + 16,
          padding: '10px 14px',
          boxShadow: 'var(--sh-popover)',
        }}
        className="pointer-events-none fixed z-overlay inline-flex items-center rounded-panel border border-soft-line bg-soft-surface text-md text-soft-ink-2 whitespace-nowrap"
      >
        {text}
      </div>
    </BodyPortal>
  );
}

/**
 * 접힘 레일 툴팁 (§4.1 접힘 툴팁) — ink 면 · radius 10 · 이름 + 둘째 줄.
 * hover(기하 판정) 또는 focus 에서 뜬다.
 */
export function PaletteRailTooltip({
  x,
  y,
  name,
  detail,
}: {
  x: number;
  y: number;
  name: string;
  detail: string | null;
}) {
  return (
    <BodyPortal>
      <div
        data-palette-rail-tooltip
        role="tooltip"
        style={{
          left: x,
          top: y,
          gap: 2,
          padding: '9px 12px',
          boxShadow: 'var(--sh-popover)',
        }}
        className="pointer-events-none fixed z-overlay flex flex-col rounded-control bg-ink whitespace-nowrap"
      >
        <span className="text-md font-semibold text-soft-surface">{name}</span>
        {detail && (
          <span className="text-sm text-soft-disabled">{detail}</span>
        )}
      </div>
    </BodyPortal>
  );
}

/**
 * 접힘 레일의 작업 목록 팝오버 (§4.1 접힘 작업 목록) — 레일 오른쪽 240 ·
 * `--sh-popover` · 행 구성은 펼침 때와 **같다**(같은 `PaletteWorkList`).
 */
export function PaletteRailPopover({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <BodyPortal>
      <div
        data-palette-rail-popover
        style={{
          left: x,
          top: y,
          width: 'var(--palette-w)',
          boxShadow: 'var(--sh-popover)',
        }}
        className="fixed z-overlay overflow-hidden rounded-panel border border-soft-line bg-soft-surface"
      >
        {children}
      </div>
    </BodyPortal>
  );
}
