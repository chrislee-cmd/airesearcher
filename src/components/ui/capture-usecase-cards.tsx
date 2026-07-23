'use client';

/* ────────────────────────────────────────────────────────────────────
   CaptureUseCaseCards — 캡처 입력 소스를 "인터뷰 방식 + 화자별 음성
   라우팅" 3-카드로 고르는 공유 프리미티브 (enum-agnostic).

   배경: probing / 동시통역 두 위젯이 각각 추상적인 캡처모드 셀렉터
   (mic / tab / both 드롭다운) 를 갖고 있었다. 값 자체는 의미가 명확하지
   않아 ("탭 오디오" 가 무슨 시나리오인지 사용자가 알기 어렵다), 이를
   유스케이스(🤝 오프라인 / 💻 온라인 / 👀 참관) + 진행자·참석자 음성이
   각각 어디로 들어오는지(마이크/탭) 로 재표현한다.

   enum-agnostic: 이 컴포넌트는 위젯의 모드 enum 을 모른다. 옵션 리스트
   (id 문자열 + 라벨) 만 받고 onChange(id) 로 되돌린다. probing 은
   'mic'|'tab'|'both' 로, 동시통역은 'mic-only'|'tab-only'|'both' 로 각자
   매핑한다 (enum 통일은 이 PR 범위 밖).

   접근성: role="radiogroup" + 각 카드 role="radio" aria-checked. 카드는
   native <button> (ui/ 는 react/forbid-elements 예외 — 프리미티브 정의
   지점). disabled 면 전체 그룹 비활성 (세션 중 소스 잠금).

   토큰: 선택 = border-amore + shadow-memphis-md-amore + amore 코너 체크.
   미선택 = border-line + shadow-memphis-sm-faint. rounded-sm / bg-paper.
   하드코딩 hex/px 없음 (design-system 가드 준수).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export type CaptureUseCaseOption = {
  // 위젯별 모드값 (예: 'mic' | 'both' | 'tab-only'). 이 컴포넌트는 불투명
  // 문자열로만 취급 — 의미 해석은 호출부 매핑 테이블 책임.
  id: string;
  // 유스케이스 아이콘 (듀오톤 offline/online/observe). 장식이라 aria-hidden —
  // 호출부가 DuotoneIcon 노드를 넘긴다(예전 이모지 문자열에서 R7 교체).
  icon: ReactNode;
  // 카드 제목 — 유스케이스 이름 (예: "오프라인 인터뷰").
  title: string;
  // 카드 설명 한 줄 (예: "만나서 대화하는 인터뷰입니다"). 인터뷰 방식 3-카드가
  // 사용 — 있으면 이 한 줄만 렌더(hostVia/guestVia 대신). 역할·오디오 표기가
  // 어렵다는 사용자 리뷰 → 친근한 한 줄로 교체(R15).
  desc?: string;
  // (레거시 2줄 표기) 진행자/참석자 음성 라우팅. desc 미제공 시에만 렌더.
  // moderator-ai 테스트 방식 2-카드는 이제 이 둘도 미제공 → 제목 1라인만 렌더.
  hostVia?: string;
  guestVia?: string;
  // 선택 시 카드 하단에 노출되는 부가 안내 (선택 사항). 오프라인=화자 구분
  // 없음 정직 카피, 온라인=both 비용 경고 등. 미선택 카드엔 노출 안 함.
  note?: string;
};

export function CaptureUseCaseCards({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  columns = 3,
}: {
  options: CaptureUseCaseOption[];
  // 현재 선택된 id. 미선택('')이면 어떤 카드도 활성 표시 안 됨.
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  // 라디오 그룹 전체를 설명하는 라벨 (예: "인터뷰 방식").
  ariaLabel: string;
  // 열 수 — probing/통역 = 3(기본), AI UT 테스트방식 = 2. 정적 리터럴 두 개라
  // Tailwind JIT 가 둘 다 픽업(동적 클래스 조립 아님).
  columns?: 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid gap-[11px] ${columns === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
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
              // Canvas 1c method 카드 지오메트리(GEOMETRY.md §3): radius ~13 ·
              // padding 13x11 · border 2 고정(상태 무관 → 선택 시 폭 변화로 인한
              // 레이아웃 shift 0). radius 는 토큰 rounded-sm(14px) 사용 — 실측 13 과
              // 1px 차, 디자인 하드코드 게이트(check:design)상 토큰만 허용이라
              // 보수적으로 근접 토큰 선택. 선택 = amore border-2 + soft glow
              // (shadow-select-glow, R6 proposed) — 기존 memphis 하드 오프셋 대체.
              // 높이 = 고정 128 (MODECARD-FIX 델타). 카드 높이가 title/desc 줄수에
              // 따라 flex 로 늘어나 같은 행(2-card UT 제목1줄 vs 3-card 인터뷰
              // 제목+설명)의 높이가 어긋나던 버그를 봉인 — box-border + flex-col
              // justify-start(top-align, 남는 공간은 하단 균일 패딩) + 텍스트 clamp.
              // overflow-hidden 으로 선택 note 초과분도 프레임 밖 유출 방지.
              'relative flex h-[var(--mode-card-h)] flex-col justify-start gap-1.5 overflow-hidden rounded-sm border-2 bg-paper box-border px-[11px] py-[13px] text-left',
              'transition-[border-color,box-shadow] duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-amore shadow-select-glow'
                : 'border-line shadow-memphis-sm-faint',
            ].join(' ')}
          >
            {/* 코너 체크 — 선택된 카드에만. amore 원형 + ✓ */}
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
            {/* title 최대 2줄 clamp (고정 128 안에서 넘침 방지, MODECARD-FIX). */}
            <span className="line-clamp-2 text-sm font-medium text-ink">{opt.title}</span>
            {opt.desc ? (
              // 인터뷰 방식 3-카드 — 친근한 한 줄 설명(R15). 단일 문자열 → 2줄 clamp.
              <span className="line-clamp-2 text-xs text-mute">{opt.desc}</span>
            ) : opt.hostVia || opt.guestVia ? (
              // 레거시 2줄 표기(진행자/참석자 라우팅). desc·hostVia·guestVia 셋 다
              // 없으면 제목만 렌더(1라인 카드 — moderator-ai 테스트 방식 2-카드).
              // 각 프래그먼트 1줄 clamp (MODECARD-FIX 멀티-프래그먼트 규칙).
              <span className="flex flex-col gap-0.5 text-xs text-mute">
                <span className="line-clamp-1">{opt.hostVia}</span>
                <span className="line-clamp-1">{opt.guestVia}</span>
              </span>
            ) : null}
            {selected && opt.note && (
              <span className="mt-0.5 line-clamp-2 text-xs text-mute-soft">{opt.note}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
