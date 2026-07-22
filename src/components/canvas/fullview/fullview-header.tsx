'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewHeader — 풀뷰 V2 공유 셸의 헤더 스캐폴드 (design-handoff/
   FULLVIEW-SHELL.md §F3).

   셸은 밴드 레이아웃 + 타이틀 + 닫기 ✕ 만 소유하고, 프로젝트 pill · 상태
   chip · End-session 등 위젯 종속 액션은 slot(props)으로 위젯이 주입한다
   ("셸은 스캐폴드"). 재사용 가능한 프레젠테이션 조각(pill/chip/end-session)
   은 CD 클래스맵대로 여기서 export — 후속 위젯 전환 PR 이 그대로 조합한다.

   band: border-b-2 ink · pad 13/24 · bg = per-widget 파스텔(tone prop).
   title: Outfit 800 · --fv-title-size(22) · ls -0.5 (29px 카드 타이틀 아님).
   close ✕: 32px · fv-radius-close(9) · border 1.5 ink · memphis-sm.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

// 타이틀은 카드(29px) 와 구분되는 풀뷰 전용 타입 — Outfit 800 / --fv-title-size
// / ls -0.5. font-family 는 widget-shell 카드 타이틀과 동일한 런타임 var 소비.
const FV_TITLE_STYLE = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
  fontSize: 'var(--fv-title-size)',
  fontWeight: 800,
  letterSpacing: '-0.5px',
  lineHeight: 1.1,
} as const;

export function FullviewHeader({
  title,
  tone,
  projectPill,
  statusChip,
  actions,
  onClose,
  closeLabel,
}: {
  title: ReactNode;
  // 헤더밴드 배경 톤 — CSS 값(예: 'var(--widget-header-bg-sky)'). 미지정 시
  // 기본 밴드(투명 → 프레임 bg 상속).
  tone?: string;
  // 위젯 주입 슬롯 — 프로젝트 pill(타이틀 옆) · 상태 chip · 액션(End-session
  // 등). 셸은 자리만 잡고 위젯이 내용/동작을 소유한다.
  projectPill?: ReactNode;
  statusChip?: ReactNode;
  actions?: ReactNode;
  // 닫기 ✕ (모달 닫기). 미지정 시 ✕ 미렌더 (풀페이지 chrome 등).
  onClose?: () => void;
  closeLabel?: string;
}) {
  const tCommon = useTranslations('Common');
  const resolvedCloseLabel = closeLabel ?? tCommon('close');
  return (
    <header
      className="flex shrink-0 items-center gap-[11px] border-b-2 border-ink px-6 py-[13px]"
      style={tone ? { background: tone } : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-[14px]">
        <div className="min-w-0">
          <h2 className="truncate text-ink" style={FV_TITLE_STYLE}>
            {title}
          </h2>
        </div>
        {projectPill}
      </div>
      {statusChip}
      {actions}
      {onClose ? (
        // eslint-disable-next-line react/forbid-elements -- CD §F3 close ✕ 는 32px·fv-radius-close(9)·memphis-sm 스퀘어 chrome 으로 IconButton 의 고정 radius(rounded-xs/full) variant 와 맞지 않음(§7.11: className 으로 variant radius override 불가). 레거시 셸의 닫기 처리와 동일 선례.
        <button
          type="button"
          onClick={onClose}
          aria-label={resolvedCloseLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fv-radius-close)] border-[1.5px] border-ink bg-paper text-xl font-bold text-ink shadow-memphis-sm"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </header>
  );
}

// ── 재사용 프레젠테이션 조각 (§F3 클래스맵) ─────────────────────────────
// 위젯이 header 슬롯으로 주입한다. 셸은 기본 렌더 안 함 — 위젯 종속.

// 프로젝트 pill — 📁 + 이름 + ▾. paper · border 1.5 ink · radius-pill ·
// memphis-sm. onClick 지정 시 드롭다운 트리거(behavior 는 위젯 소유).
export function FullviewProjectPill({
  name,
  trailing,
}: {
  name: ReactNode;
  // 옵션: 이름 뒤 글리프 (기본 ▾ 드롭다운 힌트).
  trailing?: ReactNode;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-paper px-3 py-[5px] shadow-memphis-sm">
      <span aria-hidden className="text-lg">
        📁
      </span>
      <span className="text-md font-bold text-ink">{name}</span>
      <span aria-hidden className="text-xs text-ink">
        {trailing ?? '▾'}
      </span>
    </span>
  );
}

// 상태 chip — mono 11/700, dot(live=amore · rec=rec). paper · border 1.5 ink
// · radius-pill.
export function FullviewStatusChip({
  label,
  tone = 'live',
}: {
  label: ReactNode;
  tone?: 'live' | 'rec';
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[11px] py-1 font-mono-label text-sm font-bold text-ink">
      <span
        aria-hidden
        className={`h-[7px] w-[7px] rounded-full ${
          tone === 'rec' ? 'bg-rec' : 'bg-amore'
        }`}
      />
      {label}
    </span>
  );
}

// End-session 버튼 — border 2 amore-deep · text amore-deep · radius-pill ·
// fv-shadow-crimson. behavior(위젯 stop 액션 미러)는 소비처가 onClick 으로.
export function FullviewEndSessionButton({
  onClick,
  label,
}: {
  onClick?: () => void;
  label: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §F3 End-session 은 amore-deep pill(border 2·text·fv-shadow-crimson) 전용 chrome 으로 Button primitive variant 와 불일치. destructive variant 는 solid fill 이라 CD 의 outline+crimson-memphis 와 다름.
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-2 border-amore-deep bg-paper px-3.5 py-1.5 text-md font-extrabold text-amore-deep shadow-[var(--fv-shadow-crimson)]"
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-2xs bg-amore-deep"
      />
      {label}
    </button>
  );
}
