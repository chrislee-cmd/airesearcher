'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingSectionQuestionsModal — 위젯(페르소나/custom section) 카드 클릭 시
   그 위젯에 누적된 질문 목록을 팝업으로 노출 (PR: probing-question-history-
   per-widget). 전역 스택을 위젯-귀속 뷰로 대체 — 인터뷰어가 특정 위젯을
   보강할 때 그 위젯의 누적 질문을 바로 본다.

   핀(★)/복사/삭제 어포던스는 기존 history 행(thinking-rail HistoryRow)에서
   이관. 부모(probing-fullview-body)가 history state 를 단일 소유하고, 액션은
   probing-card 의 handleHistory* 핸들러로 위임된다(질문 id/text 기준이라
   section 무관하게 동작).
   ──────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import type { ProbingThinkImportance } from '@/lib/probing-prompts';
import type { HistoryQuestion } from '../../widgets/probing-types';

type ProbingT = ReturnType<typeof useTranslations>;

const IMPORTANCE_DOTS: Record<ProbingThinkImportance, string> = {
  high: '●●●',
  medium: '●●○',
  low: '●○○',
};
const IMPORTANCE_DOT_COLOR: Record<ProbingThinkImportance, string> = {
  high: 'text-amber',
  medium: 'text-amore',
  low: 'text-mute-soft',
};

function techniqueLabelOf(technique: string | null | undefined, t: ProbingT): string {
  if (!technique) return 'probe';
  const known = ['contrast', 'devils_advocate', 'balance_game', 'clarification', 'timeline'];
  return known.includes(technique) ? t(`technique.${technique}`) : technique;
}

function formatRelative(epochMs: number, nowMs: number, t: ProbingT): string {
  if (!Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return t('history.justNow');
  if (diff < 60 * 60_000) return t('history.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 24 * 60 * 60_000) return t('history.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('history.daysAgo', { n: Math.floor(diff / 86_400_000) });
}

export function ProbingSectionQuestionsModal({
  open,
  label,
  questions,
  nowMs,
  onClose,
  onCopy,
  onToggleStar,
  onDelete,
}: {
  open: boolean;
  label: string;
  questions: HistoryQuestion[];
  nowMs: number;
  onClose: () => void;
  onCopy: (text: string) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('Probing');

  // 핀(별표) 우선 → 같은 group 은 최신 dismissed_at 먼저 (legacy 정렬 로직 미러).
  const sorted = useMemo(() => {
    const arr = [...questions];
    arr.sort((a, b) => {
      if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
      return b.dismissed_at - a.dismissed_at;
    });
    return arr;
  }, [questions]);

  return (
    <Modal open={open} onClose={onClose} size="md" title={t('fv.sectionQuestionsTitle', { label })}>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-md italic text-mute-soft">
          {t('fv.sectionQuestionsEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((q) => (
            <SectionQuestionRow
              key={q.id}
              question={q}
              nowMs={nowMs}
              t={t}
              onCopy={() => onCopy(q.text)}
              onToggleStar={() => onToggleStar(q.id)}
              onDelete={() => onDelete(q.id)}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}

function SectionQuestionRow({
  question,
  nowMs,
  t,
  onCopy,
  onToggleStar,
  onDelete,
}: {
  question: HistoryQuestion;
  nowMs: number;
  t: ProbingT;
  onCopy: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const dots = IMPORTANCE_DOTS[question.importance];
  const dotColor = IMPORTANCE_DOT_COLOR[question.importance];
  const rel = formatRelative(question.emitted_at, nowMs, t);
  const technique = techniqueLabelOf(question.technique, t);
  const leftAccent = question.is_starred
    ? 'border-l-[3px] border-l-amore'
    : question.importance === 'high'
      ? 'border-l-[3px] border-l-amber'
      : '';

  return (
    <li
      className={`group rounded-[var(--fv-radius-field)] border-[1.4px] border-line px-[11px] py-[9px] ${leftAccent}`}
    >
      <div className="mb-[3px] flex items-center gap-[7px]">
        <span
          className={`font-mono-label text-xs leading-none tracking-[1px] ${dotColor}`}
          aria-hidden
        >
          {dots}
        </span>
        <span className="text-xs uppercase tracking-[0.14em] text-line-empty">
          {technique}
          {rel ? ` · ${rel}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* copy / delete / star — 20px compact row 액션. thinking-rail
              HistoryRow 선례 그대로: IconButton primitive 최소 크기(32)가 이
              히스토리 행 스케일을 깨므로 native button 유지. data-canvas-action
              으로 globals [data-canvas-body] button cascade opt-out. */}
          {/* eslint-disable-next-line react/forbid-elements -- compact 20px history-row action; IconButton min size(32) breaks row scale. */}
          <button
            type="button"
            onClick={onCopy}
            aria-label={t('history.copy')}
            title={t('history.copy')}
            data-canvas-action
            className="flex h-5 w-5 items-center justify-center rounded-2xs text-mute-soft opacity-0 hover:text-ink group-hover:opacity-100"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          {/* eslint-disable-next-line react/forbid-elements -- compact 20px history-row action; IconButton min size(32) breaks row scale. */}
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('history.delete')}
            title={t('history.delete')}
            data-canvas-action
            className="flex h-5 w-5 items-center justify-center rounded-2xs text-mute-soft opacity-0 hover:text-ink group-hover:opacity-100"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line react/forbid-elements -- compact ★ toggle; primitive capsule shape breaks the inline star glyph scale. */}
          <button
            type="button"
            onClick={onToggleStar}
            aria-label={question.is_starred ? t('history.unstar') : t('history.star')}
            title={question.is_starred ? t('history.unstar') : t('history.star')}
            data-canvas-action
            className={`text-sm leading-none ${question.is_starred ? 'text-amore' : 'text-line-empty hover:text-amore'}`}
          >
            ★
          </button>
        </div>
      </div>
      <p className="text-md leading-snug text-ink-2">{question.text}</p>
      {question.rationale && (
        <p className="mt-[5px] text-xs leading-relaxed text-mute">{question.rationale}</p>
      )}
    </li>
  );
}
