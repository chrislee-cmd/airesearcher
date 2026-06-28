'use client';

/* ────────────────────────────────────────────────────────────────────
   QuestionPane — probing 위젯 우패널 (PR: probing-two-pane-reflection).

   좌패널 Reflection Agent 가 만든 응답자 성찰을 컨텍스트로, 검증·심화
   probing 질문을 표시. 누적 질문 list + ★ / ✕ 액션 + "지금 제안" 수동
   버튼. 자동 트리거는 부모 (probing-card.tsx) 가 좌패널 reflection 완료
   시점에 호출.

   기존 PR-12/13/15 의 row UI / Memphis 액션 버튼 / ★ wash highlight 는
   그대로 옮겨왔다 — supplement PR 의 svg 글리프 fix 포함.
   ──────────────────────────────────────────────────────────────────── */

import { Button } from '@/components/ui/button';
import {
  PROBING_TECHNIQUE_LABEL,
  type ProbingTechnique,
} from '@/lib/probing-prompts';
import type {
  ProbingQuestion,
  ProbingQuestionRow,
  ProbingSuggestionSet,
} from '../probing-types';

const memphisPlaceholderStyle = {
  border: '2px solid var(--canvas-card-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

function formatRelativeKo(epochMs: number, nowMs: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return '방금 전';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

export function QuestionPane({
  current,
  questions,
  streaming,
  hydrating,
  selectedId,
  nowMs,
  isLive,
  hasTranscript,
  hasReflection,
  canSuggest,
  onSuggest,
  onSelect,
  onCopy,
  onToggleCore,
  onDelete,
}: {
  current: ProbingSuggestionSet | null;
  questions: ProbingQuestionRow[];
  streaming: boolean;
  hydrating: boolean;
  selectedId: string | null;
  nowMs: number;
  isLive: boolean;
  hasTranscript: boolean;
  hasReflection: boolean;
  canSuggest: boolean;
  onSuggest: () => void;
  onSelect: (id: string) => void;
  onCopy: (text: string) => void;
  onToggleCore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const totalCount = (current?.questions.length ?? 0) + questions.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            검증·probing 질문
          </span>
          {totalCount > 0 && (
            <span className="text-xs text-mute-soft">· {totalCount}개</span>
          )}
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onSuggest}
          disabled={!canSuggest}
          loading={streaming}
          loadingLabel="제안 중…"
          className="uppercase tracking-[0.18em]"
        >
          지금 제안
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {streaming && !current && questions.length > 0 && (
          <div
            className="mb-3 bg-paper px-3 py-2 text-center text-sm text-ink-2"
            style={memphisPlaceholderStyle}
          >
            제안 생성 중…
          </div>
        )}

        {totalCount > 0 && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-mute-soft">
              클릭 → 복사 · ★ → 핵심 · ✕ → 삭제
            </span>
          </div>
        )}

        <ul className="divide-y divide-line-soft">
          {current?.questions.map((q, i) => (
            <QuestionRow
              key={`stream-${current.id}-${i}`}
              text={q.text}
              technique={q.technique}
              createdAtMs={current.created_at}
              nowMs={nowMs}
              isSelected={false}
              isDimmed={selectedId !== null}
              isCore={false}
              onClick={() => onCopy(q.text)}
              onToggleCore={null}
              onDelete={null}
            />
          ))}

          {questions.map((row) => {
            const isSelected = selectedId === row.id;
            const isDimmed = selectedId !== null && !isSelected;
            return (
              <QuestionRow
                key={row.id}
                text={row.text}
                technique={row.technique}
                createdAtMs={Date.parse(row.created_at)}
                nowMs={nowMs}
                isSelected={isSelected}
                isDimmed={isDimmed}
                isCore={row.is_core}
                onClick={() => {
                  onCopy(row.text);
                  onSelect(row.id);
                }}
                onToggleCore={() => onToggleCore(row.id)}
                onDelete={() => onDelete(row.id)}
              />
            );
          })}
        </ul>

        {!current && questions.length === 0 && (
          hydrating ? (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              저장된 제안 불러오는 중…
            </div>
          ) : streaming ? (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              제안 생성 중…
            </div>
          ) : !isLive ? (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              세션을 시작하고 발화가 모이면 좌측 성찰을 검증·심화하는 질문이 표시됩니다.
            </div>
          ) : !hasTranscript ? (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              transcript 가 들어오면 첫 제안이 표시됩니다.
            </div>
          ) : !hasReflection ? (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              좌측 성찰이 만들어지면 자동으로 첫 제안이 따라옵니다.
            </div>
          ) : (
            <div
              className="bg-paper px-4 py-6 text-center text-md text-ink-2"
              style={memphisPlaceholderStyle}
            >
              좌측 성찰 갱신 시 자동 제안. &lsquo;지금 제안&rsquo; 으로 즉시 시도할 수 있어요.
            </div>
          )
        )}
      </div>
    </div>
  );
}

function QuestionRow({
  text,
  technique,
  createdAtMs,
  nowMs,
  isSelected,
  isDimmed,
  isCore,
  onClick,
  onToggleCore,
  onDelete,
}: {
  text: string;
  technique: ProbingQuestion['technique'];
  createdAtMs: number;
  nowMs: number;
  isSelected: boolean;
  isDimmed: boolean;
  isCore: boolean;
  onClick: () => void;
  onToggleCore: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const label =
    technique && technique in PROBING_TECHNIQUE_LABEL
      ? PROBING_TECHNIQUE_LABEL[technique as ProbingTechnique]
      : technique || '제안';
  const rel = formatRelativeKo(createdAtMs, nowMs);
  const wrapperOpacity = isDimmed ? (isCore ? 'opacity-60' : 'opacity-40') : '';
  const coreClasses = isCore
    ? 'bg-rose/30 border-l-2 border-rose'
    : 'border-l-2 border-transparent';
  const hasActions = Boolean(onToggleCore || onDelete);
  const actionButtonBase =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border-[2px] border-[var(--canvas-card-border)] shadow-[2px_2px_0_var(--canvas-card-border)] transition-[transform,box-shadow,background-color,color] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_var(--canvas-card-border)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--canvas-accent)]';
  return (
    <li
      className={`group flex items-start gap-3 rounded-xs px-2 py-2 transition duration-200 ${coreClasses} ${wrapperOpacity}`}
    >
      {/* eslint-disable-next-line react/forbid-elements -- inline-text clickable row. <Button> primitive enforces capsule shape incompatible with full-width left-aligned text row. */}
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onClick}
        className="min-w-0 flex-1 text-left text-md leading-[1.55] text-ink-2 transition duration-200 hover:text-amore"
      >
        <span className="mr-2 text-xs uppercase tracking-[0.18em] text-mute-soft">
          {label}
        </span>
        {text}
        {rel && (
          <span className="ml-2 text-xs text-mute-soft">· {rel}</span>
        )}
      </button>
      {hasActions && (
        <div className="flex shrink-0 items-center gap-1.5 pr-1 pt-0.5">
          {onToggleCore && (
            // eslint-disable-next-line react/forbid-elements -- Memphis-styled action button group inside list row; <IconButton> primitive doesn't expose the canvas-card Memphis chrome (offset shadow + translate-on-press) needed for D5 톤 정합.
            <button
              type="button"
              data-canvas-action
              aria-label={isCore ? '핵심 표시 해제' : '핵심으로 표시'}
              aria-pressed={isCore}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCore();
              }}
              className={`${actionButtonBase} ${
                isCore
                  ? 'bg-[var(--canvas-accent)] text-white'
                  : 'bg-white text-ink'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill={isCore ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
          {onDelete && (
            // eslint-disable-next-line react/forbid-elements -- Memphis-styled action button group inside list row; <IconButton> primitive doesn't expose the canvas-card Memphis chrome (offset shadow + translate-on-press) needed for D5 톤 정합.
            <button
              type="button"
              data-canvas-action
              aria-label="이 제안 삭제"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={`${actionButtonBase} bg-white text-ink`}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}
    </li>
  );
}
