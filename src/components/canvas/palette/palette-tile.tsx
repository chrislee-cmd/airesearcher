'use client';

/* ────────────────────────────────────────────────────────────────────
   PaletteTile — 팔레트 타일 1장. CD SSOT: `canvas-modular/full/README.md`
   §4.2 + `canvas-modular-full.dc.html` P0 (상태 사전 12종).

   **프레젠테이션 전용** — 상태 판정·드래그·위치 계산은 전부 호출부(팔레트
   패널)가 소유하고 여기로 typed props 로 내려온다.

   ── hover 를 CSS :hover 로 하지 않는 이유 ─────────────────────────────────
   §2 규칙 6: "hover, 드롭 대상, 노출 여부는 모두 포인터 좌표 대 rect 로
   판정하고 enter/leave 이벤트는 쓰지 않는다". 타일은 자기 rect 와 DOM 이
   일치하므로 `:hover` 로도 깜빡이지 않지만, **fit 상태(§5 후보 표시)가
   드래그 시작 전 hover 에서 미리 떠야** 하므로 hover 여부를 JS 가 알아야
   한다. 두 소스(CSS 와 JS)로 갈라지면 "바탕은 hover 인데 fit 칩은 안 뜬다"
   같은 어긋남이 생기므로, hover 는 **좌표 판정 결과 하나**로 내려온다.

   ── 타일 구조: 왜 버튼 하나가 아닌가 ──────────────────────────────────────
   §4.2 multi 는 그립 자리에 **개수 칩**을 둔다. 칩을 누르는 것은 "작업 목록
   펼치기"고 타일을 누르는 것은 "그 위젯이 있는 곳으로" 라 뜻이 다르다 —
   버튼 안에 버튼을 넣을 수 없으니 행은 flex 컨테이너이고 그 안에 **본체
   버튼 + 칩 버튼**이 형제로 있다. 드래그 히트 영역은 §5 대로 **타일 전체**라
   pointerdown 은 행 컨테이너가 받는다(칩이 뜨는 타일은 끌 수 없는 타일이라
   충돌이 없다 — multi 는 항상 레인 카드를 포함한다).

   ── 여기 있는 값은 전부 CD 절대값이다 ─────────────────────────────────────
   색·그림자는 Soft 토큰(`--fill`·`--ok-*`·`--sh-card` …)을 쓰고, 치수(216 ·
   36 · 11 · 18)는 CD 실측이라 arbitrary 레이아웃 값으로 둔다. 가장 가까운
   DS 기본값으로 굽히지 않는다(전사규칙 2c AUTHORITY).
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { widgetIconFor } from '@/components/canvas/shell/widget-icon';
import { ACCENT_BG } from '@/components/canvas/shell/tokens';
import type { AccentColor } from '@/components/canvas/widget-types';
import type { SignalTone, TileVisualState } from './palette-model';

/** 타일 폭 (§4.2 — 216 × --palette-tile-h). 팔레트 240 − 좌우 패딩 12×2. */
export const TILE_W = 216;

/** 시그널 배지 — 틴트 면 + 진한 글자 + 점, **테두리 없음**(Soft 핵심규칙 4). */
const SIGNAL_BADGE: Record<SignalTone, string> = {
  ok: 'bg-soft-ok-bg text-soft-ok-fg',
  run: 'bg-soft-run-bg text-soft-run-fg',
  warn: 'bg-soft-warn-bg text-soft-warn-fg',
  err: 'bg-soft-err-bg text-soft-err-fg',
  idle: 'bg-soft-fill text-soft-ink-2',
};

const SIGNAL_DOT: Record<SignalTone, string> = {
  ok: 'bg-soft-ok-dot',
  run: 'bg-soft-run-dot',
  warn: 'bg-soft-warn-dot',
  err: 'bg-soft-err-dot',
  idle: 'bg-soft-faint',
};

export type PaletteTileSecondLine =
  /** idle — `💎n` + 체인 지원 시 "체인" 칩. */
  | { kind: 'meta'; credits: string; chainChip: string | null }
  /** chain · run · attn · multi · expanded — 시그널 배지. */
  | { kind: 'badge'; tone: SignalTone; text: string; pulse: boolean }
  /** fit — ink pill "→ n단계". */
  | { kind: 'fit'; text: string }
  /** source · lifted — 평문 안내. */
  | { kind: 'note'; text: string };

export type PaletteTileProps = {
  widgetKey: string;
  name: string;
  accent: AccentColor;
  state: TileVisualState;
  /** 포인터 좌표가 이 타일 rect 안인가 (기하 판정 — §2 규칙 6). */
  hovered: boolean;
  /** pointerdown 직후 ~ 4px 이동 전 (§4.2 press). */
  pressed: boolean;
  secondLine: PaletteTileSecondLine;
  /** multi · expanded 의 개수 칩. null 이면 그립 자리를 쓴다. */
  count: number | null;
  /** 끌 수 있는가 — 체인 소속 타일은 false(그립 없음). */
  canDrag: boolean;
  /** expanded 일 때 타일 아래로 붙는 작업 목록. */
  workList?: ReactNode;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onActivate: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onCountChipClick: () => void;
  ariaLabel: string;
  ariaExpanded?: boolean;
};

/** 상태별 프레임 — CD P0 의 `tile()` 스위치를 그대로 옮긴 것. */
function frameStyle(
  state: TileVisualState,
  hovered: boolean,
  pressed: boolean,
): CSSProperties {
  // press · source · lifted · expanded · fit 은 hover 보다 우선한다 —
  // 손이 더 깊이 들어간 상태이기 때문.
  if (state === 'source') {
    return {
      border: '1px dashed var(--disabled-fg)',
      background: 'var(--surface-2)',
      opacity: 0.5,
    };
  }
  if (state === 'lifted') {
    return {
      border: '1px solid transparent',
      background: 'var(--surface)',
      boxShadow: '0 0 0 2px var(--ink), var(--sh-popover)',
    };
  }
  if (state === 'expanded') {
    return {
      border: '1px solid var(--line)',
      background: 'var(--surface)',
      boxShadow: 'var(--sh-card)',
    };
  }
  if (state === 'fit') {
    return {
      border: '1px solid transparent',
      background: 'var(--surface)',
      boxShadow: 'inset 0 0 0 1px var(--ink)',
    };
  }
  if (pressed) {
    return {
      border: '1px solid transparent',
      // CD press bg #ebe9ee — `--fill`(#f4f3f6) 보다 한 단 진한 전용 값.
      // 가장 가까운 토큰으로 굽히지 않고(AUTHORITY) raw hex 도 남기지 않도록
      // Soft 원자 두 개를 섞어 유도한다.
      background: 'color-mix(in srgb, var(--fill) 70%, var(--line) 30%)',
      transform: 'scale(.98)',
    };
  }
  if (hovered) {
    return { border: '1px solid transparent', background: 'var(--fill)' };
  }
  return { border: '1px solid transparent', background: 'transparent' };
}

export function PaletteTile({
  widgetKey,
  name,
  accent,
  state,
  hovered,
  pressed,
  secondLine,
  count,
  canDrag,
  workList,
  onPointerDown,
  onActivate,
  onKeyDown,
  onCountChipClick,
  ariaLabel,
  ariaExpanded,
}: PaletteTileProps) {
  return (
    <div
      data-palette-tile={widgetKey}
      data-palette-state={state}
      data-palette-hovered={hovered ? 'true' : undefined}
      // 드래그 히트 영역 = 타일 전체(§5 시작). pointerdown 은 여기서 받고
      // 4px 임계 판정·고스트 생성은 호출부의 드래그 훅이 소유한다.
      onPointerDown={onPointerDown}
      style={{
        width: TILE_W,
        // CD 전환: hover 120ms · press 80ms. 바탕/그림자만 전환한다.
        transition: 'background-color 120ms ease-out, box-shadow 120ms ease-out',
        ...frameStyle(state, hovered, pressed),
      }}
      className="relative shrink-0 overflow-hidden rounded-control"
    >
      <div
        style={{ height: 'var(--palette-tile-h)', gap: 11, padding: '0 10px' }}
        className="flex items-center"
      >
        {/* eslint-disable-next-line react/forbid-elements -- CD 팔레트 타일 본체는 216×64 전용 chrome(톤 타일 36 + 2줄 텍스트)이고 12상태 전부를 inline Soft 토큰으로 그린다. Button primitive 의 variant/size chrome 과 형태가 전혀 다르고 §7.11(컴파일 CSS 소스 순서)로 className override 가 불확정 — chain-toolbar·lane 헤더 액션과 동일 선례. */}
        <button
          type="button"
          data-palette-handle={widgetKey}
          aria-label={ariaLabel}
          aria-expanded={ariaExpanded}
          onClick={onActivate}
          onKeyDown={onKeyDown}
          style={{ gap: 11 }}
          className="palette-tile-handle flex min-w-0 flex-1 items-center text-left focus-visible:outline-none"
        >
          {/* 톤 타일 36 — 위젯 원색은 **이 작은 면에만** 칠한다(Soft 핵심규칙 3).
              글리프는 흰 채움 + ink 1.8 스트로크(§4.2). 글리프 선정 SSOT =
              `widgetIconFor`(리브랜드 1단계) — 카드 헤더 타일과 같은 소스라
              같은 위젯이 어디서나 같은 글리프로 읽힌다. */}
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-icon ${ACCENT_BG[accent]}`}
          >
            <DuotoneIcon
              name={widgetIconFor(widgetKey)}
              size={20}
              fill="var(--color-paper)"
            />
          </span>

          <span style={{ gap: 3 }} className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-lg font-semibold text-ink">
              {name}
            </span>
            <span
              data-palette-second-line
              style={{ gap: 6, minHeight: 18 }}
              className="flex items-center whitespace-nowrap"
            >
              <SecondLine line={secondLine} />
            </span>
          </span>
        </button>

        {count !== null ? (
          <CountChip
            count={count}
            open={state === 'expanded'}
            onClick={onCountChipClick}
          />
        ) : canDrag ? (
          <Grip />
        ) : null}
      </div>

      {state === 'expanded' && workList}
    </div>
  );
}

function SecondLine({ line }: { line: PaletteTileSecondLine }) {
  if (line.kind === 'meta') {
    return (
      <>
        <span className="font-soft-mono text-sm text-soft-mute">
          {line.credits}
        </span>
        {line.chainChip && (
          <span
            style={{ padding: '1px 7px' }}
            className="rounded-pill bg-soft-fill text-xs-soft font-semibold text-soft-mute"
          >
            {line.chainChip}
          </span>
        )}
      </>
    );
  }
  if (line.kind === 'badge') {
    return (
      <span
        data-palette-badge={line.tone}
        style={{ gap: 5, padding: '1px 8px' }}
        className={`inline-flex items-center rounded-pill text-sm font-semibold ${SIGNAL_BADGE[line.tone]}`}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6 }}
          className={`rounded-full ${SIGNAL_DOT[line.tone]} ${line.pulse ? 'palette-pulse' : ''}`}
        />
        {line.text}
      </span>
    );
  }
  if (line.kind === 'fit') {
    return (
      <span
        data-palette-fit
        style={{ padding: '1px 9px' }}
        className="rounded-pill bg-ink text-sm font-semibold text-soft-surface"
      >
        {line.text}
      </span>
    );
  }
  return <span className="text-sm text-soft-mute">{line.text}</span>;
}

/** 그립 6점 — 끌 수 있다는 **표시**다. 히트 영역은 타일 전체(§5 시작). */
function Grip() {
  return (
    <span
      aria-hidden
      data-palette-grip
      style={{ gap: 3, gridTemplateColumns: '3px 3px', opacity: 0.7 }}
      className="grid shrink-0"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{ width: 3, height: 3 }}
          className="rounded-full bg-soft-faint"
        />
      ))}
    </span>
  );
}

function CountChip({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- 개수 칩은 높이 24 · --fill 면 · mono 11/700 + ▼ 전용 chrome 으로 그립 자리를 대체한다(§4.2 multi). Button primitive 의 size variant 가 24px 높이를 주지 않고 §7.11 로 override 가 불확정 — 타일 본체와 같은 선례.
    <button
      type="button"
      data-palette-count-chip={count}
      onClick={onClick}
      aria-expanded={open}
      style={{ height: 24, gap: 3, padding: '0 7px' }}
      className="palette-tile-handle inline-flex shrink-0 items-center rounded-pill bg-soft-fill font-soft-mono text-sm font-bold text-soft-ink-2 focus-visible:outline-none"
    >
      {count}
      <span
        aria-hidden
        style={{
          fontSize: 8,
          transform: open ? 'rotate(180deg)' : undefined,
        }}
      >
        ▼
      </span>
    </button>
  );
}
