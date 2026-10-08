'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainPort — 카드 상단 테두리에 앉는 포트 (fresh 프레젠테이션).

   CD SSOT: `v2/README.md` §Geometry · `widget-chain-v2.dc.html` PORT.

   R4: 체인 진입은 **출력 포트**에서 일어난다 — v1 의 위젯 안 토글 블록을
   대체한다. 드래그로 잇는 방식(방향 ③)은 쓰지 않는다.
   포트는 **체인에 묶인 카드에만** 렌더하고, 진입 핸들은 체인을 지원하는
   위젯(파일럿 = 프로빙)에만 붙는다(WRITER-ANSWERS-V2 추가 확정).
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from 'react';

export type ChainPortKind = 'out' | 'in' | 'dim' | 'handle' | 'target';

const SIZE: Record<ChainPortKind, number> = {
  out: 16,
  in: 16,
  dim: 14,
  handle: 26,
  target: 16,
};

// 링은 토큰 var() 로만 (raw hex 0). handle = 흰 4px + amore 6px, target = amore 25%.
const RING: Partial<Record<ChainPortKind, string>> = {
  handle: '0 0 0 4px var(--color-paper), 0 0 0 6px var(--color-amore)',
  target: '0 0 0 3px color-mix(in oklab, var(--color-amore) 25%, transparent)',
};

const CHROME: Record<ChainPortKind, string> = {
  out: 'border-2 border-ink',
  in: 'border-2 border-ink bg-paper',
  dim: 'border-[1.5px] border-dashed border-line-empty bg-paper',
  handle: 'border-2 border-ink bg-ink text-paper',
  target: 'border-2 border-dashed border-ink bg-paper',
};

export type ChainPortProps = {
  kind: ChainPortKind;
  /** 포트 중심 x (surface 좌표). */
  x: number;
  /** 카드 상단 y (surface 좌표) — 포트 중심이 여기 앉는다. */
  cardTop: number;
  /** out 포트 채움 = 그 위젯 톤(`bg-sky` 등). */
  toneClass?: string;
  onClick?: () => void;
  label?: string;
};

export function ChainPort({
  kind,
  x,
  cardTop,
  toneClass,
  onClick,
  label,
}: ChainPortProps) {
  const size = SIZE[kind];
  const style: CSSProperties = {
    left: x - size / 2,
    top: cardTop - size / 2,
    width: size,
    height: size,
    boxShadow: RING[kind],
  };
  const cls = `absolute flex items-center justify-center rounded-full ${CHROME[kind]} ${
    kind === 'out' ? (toneClass ?? 'bg-paper') : ''
  }`;

  if (kind === 'handle') {
    return (
      // eslint-disable-next-line react/forbid-elements -- CD §S0 진입 핸들은 26px 원 + 2중 링(paper 4px + amore 6px) 전용 chrome. IconButton 은 고정 radius/size variant 라 형태 불일치(§7.11). fullview-header 의 CD 전용 chrome 선례와 동일.
      <button
        type="button"
        data-chain-port="handle"
        aria-label={label}
        onClick={onClick}
        style={style}
        className={`${cls} text-sm font-extrabold leading-none focus-visible:outline-none focus-visible:shadow-focus-ring`}
      >
        <span aria-hidden>+</span>
      </button>
    );
  }

  return (
    <span
      aria-hidden
      data-chain-port={kind}
      style={style}
      className={cls}
    />
  );
}
