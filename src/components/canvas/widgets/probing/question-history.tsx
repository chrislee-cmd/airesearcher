'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingQuestionHistory — 우패널 4-layer 중 D 번. 토글식 누적 패널.

   PR (probing-question-thinking-flow): popup 이 사라진 (자동 / 핀 /
   ✕ / replaced / esc) 모든 질문이 여기로 push 된다. 사용자가 헤더
   클릭으로 펼쳐서 다시 본다. 핀 된 항목은 별표 표시 + 상단 정렬.

   액션: ★ 토글 (별 마킹) / 📋 복사 / ✕ 삭제 (history 에서 제거).
   ──────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from 'react';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
  type ProbingThinkImportance,
} from '@/lib/probing-prompts';
import type { HistoryQuestion } from '../probing-types';

const IMPORTANCE_DOT_COLOR: Record<ProbingThinkImportance, string> = {
  high: 'text-warning',
  medium: 'text-amore',
  low: 'text-mute',
};

// 중요도는 반복 리스트라 3-글리프(●●●/●●○/●○○)가 시각 노이즈 →
// 단색 dot 1개로 축소. 높음/보통/낮음 의미는 색 + label(title/aria) 로 보존.
const IMPORTANCE_LABEL: Record<ProbingThinkImportance, string> = {
  high: '중요도 높음',
  medium: '중요도 보통',
  low: '중요도 낮음',
};

function formatRelativeKo(epochMs: number, nowMs: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return '방금 전';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

export function ProbingQuestionHistory({
  history,
  nowMs,
  onCopy,
  onToggleStar,
  onDelete,
}: {
  history: HistoryQuestion[];
  nowMs: number;
  onCopy: (text: string) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // 핀 된 항목 위로 정렬 — 같은 group 안은 최신 dismissed_at 먼저.
  const sorted = useMemo(() => {
    const arr = [...history];
    arr.sort((a, b) => {
      if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
      return b.dismissed_at - a.dismissed_at;
    });
    return arr;
  }, [history]);

  const starredCount = history.filter((q) => q.is_starred).length;

  return (
    <section className="shrink-0 border-t border-line-soft">
      {/* eslint-disable-next-line react/forbid-elements -- accordion header full-width toggle; Button primitive forces capsule shape and centered text incompatible with left-aligned w-full row. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-canvas-action
        className="flex w-full items-center justify-between gap-2 bg-paper px-4 py-2.5 text-left hover:bg-paper-soft"
      >
        <span className="text-sm font-medium text-ink-2">
          질문 기록 · {history.length}개
          {starredCount > 0 && (
            <span className="ml-2 text-xs text-amore">★ {starredCount}</span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="max-h-[280px] space-y-1.5 overflow-y-auto border-t border-line-soft bg-paper-soft px-3 py-3">
          {sorted.length === 0 ? (
            <li className="py-4 text-center text-sm italic text-mute-soft">
              아직 기록된 질문이 없습니다.
            </li>
          ) : (
            sorted.map((q) => (
              <HistoryRow
                key={q.id}
                question={q}
                nowMs={nowMs}
                onCopy={() => onCopy(q.text)}
                onToggleStar={() => onToggleStar(q.id)}
                onDelete={() => onDelete(q.id)}
              />
            ))
          )}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({
  question,
  nowMs,
  onCopy,
  onToggleStar,
  onDelete,
}: {
  question: HistoryQuestion;
  nowMs: number;
  onCopy: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const techniqueLabel =
    question.technique && question.technique in PROBING_TECHNIQUE_LABEL
      ? PROBING_TECHNIQUE_LABEL[question.technique as ProbingTechnique]
      : question.technique || 'probe';
  const importanceLabel = IMPORTANCE_LABEL[question.importance];
  const dotColor = IMPORTANCE_DOT_COLOR[question.importance];
  const rel = formatRelativeKo(question.emitted_at, nowMs);
  return (
    <li
      className={`rounded-xs border bg-paper px-3 py-2 ${question.is_starred ? 'border-amore border-l-[3px]' : 'border-line-soft'}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`text-xs leading-none ${dotColor}`}
          aria-label={importanceLabel}
          title={importanceLabel}
        >
          ●
        </span>
        <span className="text-xs uppercase tracking-[0.18em] text-mute-soft">
          {techniqueLabel}
        </span>
        {rel && <span className="text-xs text-mute-soft">· {rel}</span>}
      </div>
      <p className="mb-1.5 text-sm leading-snug text-ink-2">{question.text}</p>
      {question.rationale && (
        <p className="mb-2 text-xs leading-relaxed text-mute">
          {question.rationale}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <HistoryActionButton
          label={question.is_starred ? '별표 해제' : '별표'}
          onClick={onToggleStar}
          active={question.is_starred}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill={question.is_starred ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </HistoryActionButton>
        <HistoryActionButton label="복사" onClick={onCopy}>
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
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
        </HistoryActionButton>
        <HistoryActionButton label="삭제" onClick={onDelete}>
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
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
        </HistoryActionButton>
      </div>
    </li>
  );
}

function HistoryActionButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    // data-canvas-action: globals.css 의 [data-canvas-body] button cascade
    // 에서 opt-out. 이 24×24 고정 박스에 globals padding (0.4rem 0.85rem) 이
    // 얹히면 content area 가 음수가 돼 12×12 SVG 글리프가 vanish — popup 과
    // 동일한 PR #552 회귀 패턴 (question history 가 canvas-body 안에 mount).
    // eslint-disable-next-line react/forbid-elements -- compact 24px row action; IconButton primitive minimum size (32) breaks the history row scale. Tokens / tokens-soft chrome preserved.
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-canvas-action
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-xs border ${active ? 'border-amore bg-amore-bg text-amore' : 'border-line-soft bg-paper text-ink-2 hover:border-ink'}`}
    >
      {children}
    </button>
  );
}
