'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptMethodCards — 전사 방식을 아이콘+제목+서브 2-카드로 고르는
   공유 프리미티브 (enum-agnostic).

   배경: 전사록(quotes) 위젯의 세팅 V2(유스케이스 아코디언) STEP2. 옛
   ModeCardGroup(중앙정렬 아이콘+라벨) 을 CaptureUseCaseCards 와 동일한
   "AI UT 선택 룩"(2px amore 보더 + soft glow + 우상단 ✓) 으로 정렬한다.
   CaptureUseCaseCards 는 인터뷰 캡처(진행자/참석자 2줄 라우팅) 전용 shape
   라 여기(단일 서브 1줄)엔 맞지 않아 별도 프리미티브로 둔다 — 두 위젯의
   선택 카드 shape 이 다르므로 공유 컴포넌트를 억지로 늘리지 않는다.

   enum-agnostic: 위젯 모드 enum 을 모른다. 옵션(id 문자열 + 라벨) 만 받고
   onChange(id) 로 되돌린다 — quotes 는 'research'|'meeting' 으로 매핑한다.

   접근성: role="radiogroup" + 각 카드 role="radio" aria-checked. 카드는
   native <button> (ui/ 는 react/forbid-elements 예외 — 프리미티브 정의 지점).

   토큰: 선택 = border-amore + shadow-select-glow + amore 코너 ✓.
   미선택 = border-line + shadow-memphis-sm-faint. rounded-sm / bg-paper.
   하드코딩 hex/px 없음 (design-system 가드 준수, CaptureUseCaseCards 와 동일).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export type TranscriptMethodOption = {
  // 위젯별 모드값 (예: 'research' | 'meeting'). 이 컴포넌트는 불투명 문자열로만
  // 취급 — 의미 해석은 호출부 매핑 책임.
  id: string;
  // 방식 아이콘 (듀오톤 mic/minutes). 장식이라 aria-hidden — 호출부가
  // DuotoneIcon 노드를 넘긴다.
  icon: ReactNode;
  // 카드 제목 — 방식 이름 (예: "정성 인터뷰 전사").
  title: string;
  // 제목 아래 한 줄 설명 (예: "1:1 심층 · 화자 분리").
  subtitle: string;
};

export function TranscriptMethodCards({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  options: TranscriptMethodOption[];
  // 현재 선택된 id. 미선택('')이면 어떤 카드도 활성 표시 안 됨.
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  // 라디오 그룹 전체를 설명하는 라벨 (예: "전사 방식 선택").
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid grid-cols-2 gap-[11px]"
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={[
              // Canvas 1c method 카드 지오메트리(GEOMETRY.md §2): radius ~13 ·
              // padding 13x11 · border 2 고정(상태 무관 → 선택 시 폭 변화 shift 0).
              // radius 는 토큰 rounded-sm(14px). 선택 = amore border-2 + soft glow
              // (shadow-select-glow) — CaptureUseCaseCards 와 동일.
              'relative flex flex-col gap-1.5 rounded-sm border-2 bg-paper px-[11px] py-[13px] text-left',
              'transition-[border-color,box-shadow] duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-amore shadow-select-glow'
                : 'border-line shadow-memphis-sm-faint',
            ].join(' ')}
          >
            {/* 코너 ✓ — 선택된 카드에만. amore 원형 + 체크 (CaptureUseCaseCards 동형) */}
            {selected && (
              <span
                aria-hidden
                className="absolute right-2 top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-amore text-paper"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 6.5 5 9l4.5-5" />
                </svg>
              </span>
            )}
            <span aria-hidden className="flex leading-none">
              {opt.icon}
            </span>
            <span className="text-sm font-medium text-ink">{opt.title}</span>
            <span className="text-xs text-mute">{opt.subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}
