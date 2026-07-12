'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ─── ControlTrigger — 위젯 컨트롤 드롭다운 공용 trigger ──────────────────────
// 컨트롤 패널 드롭다운(전사록 언어 · 리크루팅 폼 · 통역 원어/번역/캡처 ·
// 데스크 지역/기간/소스 · 프로빙 소스/언어)의 trigger 외형을 한 곳에서 소유.
// 통일 기준 = 인터뷰 결과 생성기의 프로젝트 선택 드롭다운 (Button variant=ghost).
//
// 인터뷰 트리거의 정체 = Memphis "ghost" 버튼: 2.5px border-line(회색) +
// 옅은 하드 그림자 shadow-memphis-sm-faint + rounded-sm +
// font-semibold + hover 시 border-ink 로 진해지며 살짝 뜨는(translate) pop.
// 우측에 ▼ 삼각형. 이 chrome 을 그대로 CONTROL_TRIGGER_CLASS 로 박제해
// DropdownMenu/SelectMenu/DateRangePopover 등 모든 컨트롤 트리거가 눈에
// 완전히 같아 보이게 한다.
//
// data-canvas-action 필수: canvas widget([data-canvas-body]) 안의
// `button:not([data-canvas-action])` 은 globals.css cascade 로 검정 2.5px +
// 8px radius + 검정 3px 그림자 + font 700 으로 강제 덮인다. 인터뷰 Button 이
// 그렇듯 이 attribute 로 opt-out 해야 위 ghost chrome 이 정확히 렌더된다.

export const CONTROL_TRIGGER_CLASS =
  'flex h-10 w-full items-center justify-between gap-1.5 rounded-sm ' +
  'border-[2.5px] border-line bg-paper px-3 text-sm font-semibold text-ink ' +
  'shadow-memphis-sm-faint transition-all duration-[120ms] ' +
  'hover:-translate-x-px hover:-translate-y-px hover:border-ink hover:shadow-memphis-md ' +
  'focus:outline-none focus-visible:border-amore ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none disabled:shadow-none';

// 공용 chevron — 인터뷰 트리거의 rightIcon(▼ 채워진 삼각형)과 동일 글리프.
// 모든 컨트롤 드롭다운 trigger 가 이 chevron 을 우측에 둔다.
export function ControlTriggerChevron() {
  return (
    <span aria-hidden className="shrink-0 leading-none">
      ▼
    </span>
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
// 개별 조정용. 공용 chrome 은 항상 유지.
export function ControlTrigger({
  children,
  className,
  ...rest
}: ControlTriggerProps) {
  return (
    // native <button> 허용 — src/components/ui/ 안(primitive 내부).
    // data-canvas-action: canvas cascade opt-out (위 주석 참고).
    <button
      type="button"
      data-canvas-action
      className={
        className
          ? `${CONTROL_TRIGGER_CLASS} ${className}`
          : CONTROL_TRIGGER_CLASS
      }
      {...rest}
      data-ds-primitive="ControlTrigger"
    >
      <span className="truncate">{children}</span>
      <ControlTriggerChevron />
    </button>
  );
}
