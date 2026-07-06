'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ─── ControlTrigger — 위젯 컨트롤 드롭다운 공용 trigger ──────────────────────
// 컨트롤 패널 드롭다운(전사록 언어 · 리크루팅 폼 · 통역 원어/번역/캡처 ·
// 데스크 지역/기간/소스 · 프로빙 소스/언어)의 trigger 외형을 한 곳에서 소유.
// 이전엔 desk `DESK_OPTION_TRIGGER_CLASS` + probing 인라인 문자열로 h-10
// bordered box 를 복붙했는데, DropdownMenu(portal 메뉴) 로 교체되는 native
// select 들도 같은 규격을 쓰도록 primitive 로 승격 (위젯 컨트롤 드롭다운 통일
// spec). 밸런스 튜닝 h-10 확정값 = SSOT. 컴포넌트가 달라도(SelectMenu listbox
// vs DropdownMenu menu) trigger 만큼은 눈에 완전히 같아 보인다.

export const CONTROL_TRIGGER_CLASS =
  'flex h-10 w-full items-center justify-between gap-2 rounded-xs border border-line bg-paper px-2 text-md text-ink hover:border-ink focus-visible:border-amore disabled:opacity-50';

// 공용 chevron — Select primitive 의 polyline 을 재사용해 SelectMenu 의 옛
// `▾` 글리프를 대체(픽셀 정합). 모든 컨트롤 드롭다운 trigger 가 이 chevron.
export function ControlTriggerChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-mute-soft"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

type ControlTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  // 현재 선택 값 라벨(또는 placeholder). 길면 truncate.
  children: ReactNode;
};

// DropdownMenu 의 render-prop trigger 로 쓰는 버튼. 호출부에서
// `trigger={({ open, onClick, ...aria }) => <ControlTrigger onClick={onClick}
// disabled={...} {...aria}>{label}</ControlTrigger>}` 형태로 사용.
// className 은 base(CONTROL_TRIGGER_CLASS) 에 덧붙는다 — 폭 하한(min-w) 등
// 개별 조정용. 공용 외형은 항상 유지.
export function ControlTrigger({
  children,
  className,
  ...rest
}: ControlTriggerProps) {
  return (
    // native <button> 허용 — src/components/ui/ 안(primitive 내부).
    // form-control trigger shape (SelectMenu primitive trigger 와 정합).
    <button
      type="button"
      className={
        className
          ? `${CONTROL_TRIGGER_CLASS} ${className}`
          : CONTROL_TRIGGER_CLASS
      }
      {...rest}
    >
      <span className="truncate">{children}</span>
      <ControlTriggerChevron />
    </button>
  );
}
