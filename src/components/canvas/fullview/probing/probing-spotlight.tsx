'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingSpotlight — 풀뷰 V2 high-importance 질문 스포트라이트 (CD state 02).
   design-handoff/FULLVIEW-SHELL.md §F4 · Widget Fullview Comps.dc.html state 02.

   fresh 신규 요소 — importance:high 질문이 도착하면 body 위에 전체(본문 영역)
   scrim + 중앙 대형 모달로 띄운다. 15s 카운트다운 후 history 로 자동 저장,
   hover 시 정지, Copy/Pin 액션. 카운트다운·pause·dismiss 흐름은 레거시
   question-popup 의 계약을 그대로 미러(부모 probing-card 가 history push 소유).

   §F4 계약: scrim bg-ink/34 · 모달 warning-bg · border 3px amber · radius 24
   (rounded-md, CD 토큰-스냅) · --fv-shadow-modal-amber · 질문 Outfit 700
   (--fv-spotlight-q-size) · 메타 text-warning-text-deep.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PopupQuestion } from '../../widgets/probing-types';

const COUNTDOWN_SECONDS = 15;
const TICK_INTERVAL_MS = 100;

// 링 기하 — r=20 → 둘레 ≈ 125.66 (CD state 02 svg 와 동일).
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

type ProbingT = ReturnType<typeof useTranslations>;

function techniqueLabelOf(technique: string | null | undefined, t: ProbingT): string {
  if (!technique) return 'probe';
  const known = ['contrast', 'devils_advocate', 'balance_game', 'clarification', 'timeline'];
  return known.includes(technique) ? t(`technique.${technique}`) : technique;
}

// spotlight 질문 타입 — Outfit 700 / --fv-spotlight-q-size (헤더 타이틀과 동일한
// 런타임 var 소비 패턴, fullview-header 참조).
const SPOTLIGHT_Q_STYLE = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
  fontSize: 'var(--fv-spotlight-q-size)',
  fontWeight: 700,
  lineHeight: 1.4,
  letterSpacing: '-0.5px',
} as const;

export function ProbingSpotlight({
  popup,
  onCopy,
  onPin,
  onDismiss,
  onAutoDismiss,
}: {
  popup: PopupQuestion;
  onCopy: () => void;
  onPin: () => void;
  onDismiss: () => void;
  onAutoDismiss: () => void;
}) {
  const t = useTranslations('Probing');
  // 카운트다운은 마운트 시 15s 로 초기화. 새 popup(id 변경)은 소비처가 key 로
  // 리마운트하므로 여기서 리셋 effect 불필요(setState-in-effect 회피).
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [paused, setPaused] = useState(false);

  const autoDismissRef = useRef(onAutoDismiss);
  useEffect(() => {
    autoDismissRef.current = onAutoDismiss;
  }, [onAutoDismiss]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = Math.max(0, prev - TICK_INTERVAL_MS / 1000);
        if (next <= 0) {
          queueMicrotask(() => autoDismissRef.current());
          return 0;
        }
        return next;
      });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused]);

  // ESC → manual dismiss.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismissRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const progress = secondsLeft / COUNTDOWN_SECONDS;
  const dashoffset = RING_C * (1 - progress);
  const techniqueLabel = techniqueLabelOf(popup.technique, t);

  return (
    <div className="absolute inset-0 z-fab flex items-center justify-center p-10">
      {/* scrim — 본문 영역 dim. 클릭 = dismiss(ESC/닫기와 동일 계약). */}
      <div
        aria-hidden
        onClick={onDismiss}
        className="absolute inset-0 bg-ink/34"
      />
      <div
        role="dialog"
        aria-live="polite"
        aria-label={t('popup.dialogAria')}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="relative w-full max-w-[720px] rounded-md border-[3px] border-amber bg-warning-bg p-8 shadow-[var(--fv-shadow-modal-amber)] sm:px-9"
      >
        {/* 닫기 ✕ — top-right. */}
        {/* eslint-disable-next-line react/forbid-elements -- CD §F4 spotlight close ✕ 는 30px·radius 9·memphis-sm 스퀘어 chrome 으로 IconButton 고정 radius variant 와 불일치(fullview-header 닫기와 동일 선례). */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('popup.close')}
          className="absolute right-4 top-4 flex h-[30px] w-[30px] items-center justify-center rounded-[var(--fv-radius-close)] border-2 border-ink bg-paper text-md font-bold text-ink shadow-memphis-sm"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* eyebrow — ●●● + "지금 던지세요" + technique pill + target pill. */}
        <div className="mb-[18px] flex flex-wrap items-center gap-[10px] pr-10">
          <span className="font-mono-label text-lg tracking-[2px] text-warning-text-deep" aria-hidden>
            ●●●
          </span>
          <span className="text-lg font-extrabold text-warning-text-deep">
            {t('popup.importanceHigh')}
          </span>
          <span className="rounded-pill border-[1.4px] border-line bg-paper px-[11px] py-[3px] text-sm font-bold text-mute">
            {techniqueLabel}
          </span>
          {popup.target_section_label && (
            <span className="rounded-pill bg-amore px-[11px] py-[3px] text-sm font-bold text-white">
              ◆ {t('popup.fillSection', { label: popup.target_section_label })}
            </span>
          )}
        </div>

        {/* 질문 — Outfit 700 / --fv-spotlight-q-size. */}
        <p className="mb-4 text-ink" style={SPOTLIGHT_Q_STYLE}>
          {popup.text}
        </p>

        {/* rationale — border-left amore. */}
        {popup.rationale && (
          <p className="mb-6 border-l-[3px] border-amore pl-[13px] text-xl leading-relaxed text-mute">
            {popup.rationale}
          </p>
        )}

        {/* footer — 카운트다운 링 + autosave 안내 + Copy/Pin. */}
        <div className="flex items-center gap-3">
          <div className="relative h-[46px] w-[46px] shrink-0">
            <svg width="46" height="46" viewBox="0 0 46 46" className="-rotate-90">
              <circle cx="23" cy="23" r={RING_R} fill="none" stroke="var(--color-line)" strokeWidth="4" />
              <circle
                cx="23"
                cy="23"
                r={RING_R}
                fill="none"
                stroke="var(--color-amber)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={dashoffset}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono-label text-md font-extrabold text-warning-text-deep">
              {paused ? t('popup.paused') : `${Math.ceil(secondsLeft)}s`}
            </div>
          </div>
          <p className="flex-1 text-sm text-mute-soft">
            {t('fv.spotlightAutosave')}
          </p>
          <div className="flex gap-2">
            {/* Copy / Pin — CD §F4: border-2 ink · radius 11 · memphis-sm chrome.
                Button primitive capsule/variant 와 불일치 → native 유지(셸 선례). */}
            {/* eslint-disable-next-line react/forbid-elements -- CD spotlight action chrome (border-2 ink·radius 11·memphis-sm) ≠ Button primitive variant. */}
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center gap-1.5 rounded-[var(--fv-radius-card)] border-2 border-ink bg-paper px-[15px] py-[9px] text-lg font-bold text-ink shadow-memphis-sm"
            >
              📋 {t('popup.copy')}
            </button>
            {/* eslint-disable-next-line react/forbid-elements -- CD spotlight action chrome (border-2 ink·radius 11·memphis-sm) ≠ Button primitive variant. */}
            <button
              type="button"
              onClick={onPin}
              className="flex items-center gap-1.5 rounded-[var(--fv-radius-card)] border-2 border-ink bg-paper px-[15px] py-[9px] text-lg font-bold text-ink shadow-memphis-sm"
            >
              📌 {t('popup.pin')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
