'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingQuestionPopup — 우패널 4-layer 중 C 번. floating 질문 popup.

   PR (probing-question-thinking-flow): AI 가 비주기적으로 push 한 필수
   질문을 카드 형태로 표시. 15s 카운트다운 후 자동 dismiss + history 로
   push (부모 책임). hover 시 카운트다운 정지, 마우스 떠나면 재개.

   importance 시각 강도 매핑:
     high   — warning bg + 3px 두꺼운 amore 그림자 + 등장 시 1회 pulse
     medium — paper bg + 3px ink 그림자
     low    — paper bg + 2px mute 그림자, 톤 다운

   액션:
     📌 핀 — 즉시 dismiss + history 에 starred 마킹
     📋 복사 — 클립보드 + dismiss 안 함 (사용자가 직접 던질 시간 보존)
     ✕ 닫기 — 즉시 dismiss + history 일반 저장

   카운트다운: SVG ring 으로 시각화. 15 → 0 으로 감소하면서 ring stroke
   가 줄어든다. 단순 numeric 표시도 같이 — 사용자가 한 눈에 남은 시간
   인지 가능.

   비주기적 emit + 다중 큐: 부모가 새 popup 도착 시 기존 popup 을 강제
   replace 한다 (이 컴포넌트는 단일 popup 만 mount). 큐 처리는 부모 책임.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
  type ProbingThinkImportance,
} from '@/lib/probing-prompts';
import type { PopupQuestion } from '../probing-types';

// Wrapper key 가 popup.id 로 바뀌면 React 가 컴포넌트를 완전히 다시 mount —
// useState 초기값으로 카운트다운이 시작되므로 effect 안의 setState 가 필요
// 없어진다 (lint: react-hooks/set-state-in-effect 회피).

const COUNTDOWN_SECONDS = 15;
const TICK_INTERVAL_MS = 100;

// importance → visual classes 매핑. 룰은 PR 스펙 §C 의 표 그대로.
const IMPORTANCE_CARD: Record<
  ProbingThinkImportance,
  { container: string; label: string; ring: string; pulse: boolean }
> = {
  high: {
    container:
      'border-[3px] border-warning bg-warning-bg shadow-[8px_8px_0_var(--color-warning)] max-w-[460px]',
    label: '지금 던지세요',
    ring: 'stroke-warning',
    pulse: true,
  },
  medium: {
    container:
      'border-[3px] border-ink bg-paper shadow-[6px_6px_0_var(--color-ink)] max-w-[420px]',
    label: '다음 질문 후보',
    ring: 'stroke-ink',
    pulse: false,
  },
  low: {
    container:
      'border-[2px] border-mute bg-paper shadow-[3px_3px_0_var(--color-mute)] max-w-[400px]',
    label: '여유 있을 때',
    ring: 'stroke-mute',
    pulse: false,
  },
};

const IMPORTANCE_DOTS: Record<ProbingThinkImportance, string> = {
  high: '●●●',
  medium: '●●○',
  low: '●○○',
};

const IMPORTANCE_DOT_COLOR: Record<ProbingThinkImportance, string> = {
  high: 'text-warning',
  medium: 'text-amore',
  low: 'text-mute',
};

// 외부에서 popup.id 가 바뀔 때마다 React 가 본 컴포넌트를 새 인스턴스로
// mount 하도록 부모가 key={popup.id} 를 줘야 한다. 본 wrapper 는 그
// 합의를 강제 — 새 popup 마다 카운트다운이 깨끗하게 리셋된다.
export function ProbingQuestionPopup({
  popup,
  onPin,
  onCopy,
  onDismiss,
  onAutoDismiss,
}: {
  popup: PopupQuestion;
  onPin: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  onAutoDismiss: () => void;
}) {
  return (
    <ProbingQuestionPopupInner
      key={popup.id}
      popup={popup}
      onPin={onPin}
      onCopy={onCopy}
      onDismiss={onDismiss}
      onAutoDismiss={onAutoDismiss}
    />
  );
}

function ProbingQuestionPopupInner({
  popup,
  onPin,
  onCopy,
  onDismiss,
  onAutoDismiss,
}: {
  popup: PopupQuestion;
  onPin: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  onAutoDismiss: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [paused, setPaused] = useState(false);

  // 콜백 재생성으로 effect 가 재실행되지 않도록 ref 로 잡는다.
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
          // 다음 tick 에 부모가 unmount 하도록.
          queueMicrotask(() => autoDismissRef.current());
          return 0;
        }
        return next;
      });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused]);

  // ESC 키 → manual dismiss.
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

  const visual = IMPORTANCE_CARD[popup.importance];
  const dots = IMPORTANCE_DOTS[popup.importance];
  const dotColor = IMPORTANCE_DOT_COLOR[popup.importance];
  const techniqueLabel =
    popup.technique && popup.technique in PROBING_TECHNIQUE_LABEL
      ? PROBING_TECHNIQUE_LABEL[popup.technique as ProbingTechnique]
      : popup.technique || 'probe';

  const progress = secondsLeft / COUNTDOWN_SECONDS;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="AI 가 제안한 즉시 질문"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto absolute bottom-6 right-6 z-popup w-full ${visual.container} rounded-sm bg-paper p-4 ${visual.pulse ? 'probing-popup-pulse' : ''}`}
    >
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs tracking-[0.18em] ${dotColor}`}
            aria-hidden
          >
            {dots}
          </span>
          <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            {visual.label}
          </span>
        </div>
        <span className="rounded-pill border border-ink px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-ink-2">
          {techniqueLabel}
        </span>
      </header>

      <p className="mb-3 text-md font-medium leading-snug text-ink">
        {popup.text}
      </p>

      {popup.rationale && (
        <p className="mb-3 rounded-xs border-l-[3px] border-amore bg-paper-soft px-3 py-2 text-sm leading-relaxed text-ink-2">
          {popup.rationale}
        </p>
      )}

      <footer className="flex items-center justify-between border-t border-line-soft pt-2">
        <CountdownRing
          secondsLeft={secondsLeft}
          total={COUNTDOWN_SECONDS}
          progress={progress}
          ringClass={visual.ring}
          paused={paused}
        />
        <div className="flex gap-1.5">
          <ActionButton
            label="복사"
            ariaLabel="질문 텍스트 복사"
            onClick={onCopy}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </ActionButton>
          <ActionButton
            label="핀"
            ariaLabel="핀 — 즉시 history 에 별표 저장"
            onClick={onPin}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14l-1.4-1.4A2 2 0 0 1 17 14.2V9a5 5 0 1 0-10 0v5.2a2 2 0 0 1-.6 1.4L5 17z" />
            </svg>
          </ActionButton>
          <ActionButton
            label="닫기"
            ariaLabel="이 popup 닫기"
            onClick={onDismiss}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </ActionButton>
        </div>
      </footer>
    </div>
  );
}

function CountdownRing({
  secondsLeft,
  total,
  progress,
  ringClass,
  paused,
}: {
  secondsLeft: number;
  total: number;
  progress: number;
  ringClass: string;
  paused: boolean;
}) {
  // 24px ring, stroke 3, circumference ≈ 65.97.
  const radius = 10.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const display = Math.max(0, Math.ceil(secondsLeft));
  return (
    <div
      className="flex items-center gap-2 text-xs text-mute"
      aria-label={`자동 닫힘까지 ${display}초`}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="var(--color-line-soft)"
          strokeWidth="3"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          className={ringClass}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="tabular-nums">
        {display}s {paused && <span className="text-mute-soft">(정지)</span>}
        {!paused && total !== 15 && <span className="text-mute-soft">/{total}</span>}
      </span>
    </div>
  );
}

function ActionButton({
  ariaLabel,
  label,
  onClick,
  children,
}: {
  ariaLabel: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- Memphis-styled compact action; IconButton primitive doesn't expose the offset shadow + label badge composition we need inline.
    <button
      type="button"
      aria-label={ariaLabel}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-[2px] border-ink bg-paper text-ink shadow-[2px_2px_0_var(--color-ink)] transition-[transform,box-shadow] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amore"
    >
      {children}
    </button>
  );
}
