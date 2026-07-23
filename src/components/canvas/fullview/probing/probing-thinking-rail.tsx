'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingThinkingRail — 풀뷰 V2 Probing body 우측 레일 (CD state 01 우 flex:3).
   design-handoff/FULLVIEW-SHELL.md §F4 · Widget Fullview Comps.dc.html state 01.

   fresh 신규 빌드 (레거시 question-pane 은 supersede). 데이터/핸들러(thinking
   events · history · copy/star/delete)만 재사용한다. 3-스택:
     1. AI thinking stream — THINK: SSE 라인(휘발 by design). auto-scroll.
     2. Spotlight 안내 배너 — warning-bg · ⚡ · warning-text.
     3. Question history — importance dots + technique · ago + ★ + 액션.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { HistoryQuestion, ThinkingEvent } from '../../widgets/probing-types';
import type { ProbingThinkImportance } from '@/lib/probing-prompts';

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

function ThinkingStream({
  events,
  isStreaming,
}: {
  events: ThinkingEvent[];
  isStreaming: boolean;
}) {
  const t = useTranslations('Probing');
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="border-b border-line px-4 py-[14px]">
      <div className="mb-[9px] flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full bg-amore ${isStreaming ? 'probing-thinking-pulse' : ''}`}
        />
        <span className="text-md font-extrabold text-ink">
          {t('fv.thinkingHeader')}
        </span>
      </div>
      <div
        ref={scrollerRef}
        className="flex max-h-[116px] flex-col gap-[5px] overflow-y-auto text-md leading-snug text-mute"
      >
        {events.length === 0 ? (
          <span className="italic text-mute-soft">{t('thinking.empty')}</span>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="fade-in-up whitespace-pre-wrap">
              <span aria-hidden className="text-line-empty">
                ›
              </span>{' '}
              {ev.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({
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
  // 좌측 강조 border — 별표(핀)면 amore, high importance 면 amber, 그 외 없음.
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
          {/* copy / delete / star — 20px compact row 액션. IconButton primitive
              최소 크기(32)가 이 히스토리 행 스케일을 깨므로 native button 유지
              (레거시 question-history 와 동일 선례). data-canvas-action 으로
              globals [data-canvas-body] button cascade opt-out. */}
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
    </li>
  );
}

export function ProbingThinkingRail({
  thinkingEvents,
  thinkingStreaming,
  history,
  nowMs,
  onHistoryCopy,
  onHistoryToggleStar,
  onHistoryDelete,
}: {
  thinkingEvents: ThinkingEvent[];
  thinkingStreaming: boolean;
  history: HistoryQuestion[];
  nowMs: number;
  onHistoryCopy: (text: string) => void;
  onHistoryToggleStar: (id: string) => void;
  onHistoryDelete: (id: string) => void;
}) {
  const t = useTranslations('Probing');
  // 핀(별표) 우선 정렬 — 같은 group 은 최신 dismissed_at 먼저 (legacy 정렬 로직).
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
    <div className="flex min-h-0 flex-[3] flex-col bg-paper">
      <ThinkingStream events={thinkingEvents} isStreaming={thinkingStreaming} />

      {/* Spotlight 안내 배너 — high-importance 질문이 어떻게 뜨는지 알림. */}
      <div className="flex items-center gap-2 border-b border-line bg-warning-bg px-4 py-3">
        <span aria-hidden className="text-xl">
          ⚡
        </span>
        <p className="text-md leading-snug text-warning-text">
          {t('fv.spotlightHint')}
        </p>
      </div>

      {/* Question history */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-[10px] flex items-center gap-[7px]">
          <span className="text-md font-extrabold text-ink">
            {t('fv.historyHeader')}
          </span>
          <span className="text-sm text-mute-soft">· {history.length}</span>
          {starredCount > 0 && (
            <span className="ml-auto text-sm font-bold text-amore">
              ★ {starredCount}
            </span>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-md italic text-mute-soft">
            {t('history.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((q) => (
              <HistoryRow
                key={q.id}
                question={q}
                nowMs={nowMs}
                t={t}
                onCopy={() => onHistoryCopy(q.text)}
                onToggleStar={() => onHistoryToggleStar(q.id)}
                onDelete={() => onHistoryDelete(q.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
