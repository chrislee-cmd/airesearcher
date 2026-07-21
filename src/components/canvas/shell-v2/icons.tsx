'use client';

/* ────────────────────────────────────────────────────────────────────
   V2 Unified Widget Canvas — stroke icon set.

   design-handoff `Icon System.dc.html` / `Widgets Canvas 1c.dc.html` 의
   24×24 viewBox · stroke-width 2 · round cap/join · ink stroke 규격을 그대로
   옮긴다. duotone 모드는 내부를 위젯 파스텔로 tint (fill prop = CSS 변수).

   색은 전부 currentColor / var(--widget-*) — 하드코드 hex 0 (check:design).
   호출처가 style.color 로 stroke 색을, fill prop 으로 duotone tint 를 정한다.
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties, ReactNode } from 'react';

// SSOT 아이콘 path 집합 (필요한 서브셋만 — recruiting + 셸 chrome).
// duotone: 첫 path 에 fill(위젯 파스텔), 나머지는 stroke 라인.
function paths(name: string, fill: string): ReactNode {
  switch (name) {
    case 'diamond':
      return (
        <>
          <path d="M6 4h12l3 5-9 11L3 9z" fill={fill} />
          <path d="M3 9h18M9 4L6 9l6 11 6-11-3-5" />
        </>
      );
    case 'upload':
      return (
        <>
          <path d="M12 15V4" />
          <path d="M8 8l4-4 4 4" />
          <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
        </>
      );
    case 'link':
      return (
        <>
          <path d="M9.5 14.5l5-5" />
          <path d="M11 6.5l1-1a3.8 3.8 0 0 1 5.4 5.4l-1 1" />
          <path d="M13 17.5l-1 1a3.8 3.8 0 0 1-5.4-5.4l1-1" />
        </>
      );
    case 'document':
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" fill={fill} />
          <path d="M14 3v4h4" />
          <path d="M9 13h6M9 17h5" />
        </>
      );
    case 'minutes':
      return (
        <>
          <rect x="5" y="3" width="14" height="18" rx="1.6" fill={fill} />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      );
    case 'fullview': // expand corners (두 대각 화살표)
      return (
        <>
          <path d="M9 4H4v5" />
          <path d="M4 4l6 6" />
          <path d="M15 20h5v-5" />
          <path d="M20 20l-6-6" />
        </>
      );
    case 'palette': // change color (물감 팔레트)
      return (
        <>
          <path
            d="M12 3a9 9 0 1 0 0 18c1.4 0 2.2-1 2.2-2.1 0-.6-.2-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-3.6-3.9-6.5-9-6.5z"
            fill={fill}
          />
          <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
        </>
      );
    default:
      return null;
  }
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  // duotone tint (CSS 변수). mono 모드면 무시하고 fill 없음.
  fill = 'none',
  mono = false,
  className,
  style,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  fill?: string;
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {paths(name, mono ? 'none' : fill)}
    </svg>
  );
}
