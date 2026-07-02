'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingResearchContext — 우패널 상단의 사용자 입력 패널.

   PR (probing-question-thinking-flow): 우패널 4-layer 중 A 번. 3 필드:
     1. research_goal (조사 목적) — Textarea 2 rows
     2. hypotheses (핵심 가설 list) — chip container + ChipInput, Enter 분리
     3. key_research_question (KRQ) — Textarea 2 rows

   PR (probing-custom-section-ui): KRQ 텍스트 필드를 제거하고 그 자리를
   **"위젯 추가"** 방식으로 대체.
   PR (probing-widget-add-move-to-left-grid): "조사 위젯" 섹션 + "+ 위젯 추가"
   버튼을 이 우패널에서 제거하고 좌패널 페르소나 grid 의 마지막 칸
   (AddCustomSectionCard) 으로 이동. 본 컴포넌트는 조사 목적 + 핵심 가설만
   담당한다.

   영속화: research_context 는 부모 (probing-card) 가 GET/PUT
   `/api/probing/research-context`. 본 컴포넌트는 controlled props 로 표시 /
   갱신만 한다.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type KeyboardEvent } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/ui/chip-input';
import { IconButton } from '@/components/ui/icon-button';

const GOAL_MAX = 2_000;
const HYPOTHESIS_MAX = 500;
const HYPOTHESES_COUNT_MAX = 20;

export function ProbingResearchContext({
  researchGoal,
  hypotheses,
  onResearchGoalChange,
  onHypothesesChange,
  disabled = false,
}: {
  researchGoal: string;
  hypotheses: string[];
  onResearchGoalChange: (next: string) => void;
  onHypothesesChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft('');
      return;
    }
    if (hypotheses.length >= HYPOTHESES_COUNT_MAX) {
      setDraft('');
      return;
    }
    if (hypotheses.includes(trimmed)) {
      setDraft('');
      return;
    }
    onHypothesesChange([...hypotheses, trimmed.slice(0, HYPOTHESIS_MAX)]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (
      e.key === 'Backspace' &&
      draft.length === 0 &&
      hypotheses.length > 0
    ) {
      e.preventDefault();
      onHypothesesChange(hypotheses.slice(0, -1));
    }
  }

  function removeHypothesis(idx: number) {
    onHypothesesChange(hypotheses.filter((_, i) => i !== idx));
  }

  return (
    <section className="space-y-3 border-b-[2px] border-line-soft bg-paper px-4 py-3">
      <Field
        label="조사 목적"
        description="이 인터뷰로 알고자 하는 것 (1~2 문장)"
      >
        <Textarea
          value={researchGoal}
          onChange={(e) =>
            onResearchGoalChange(e.target.value.slice(0, GOAL_MAX))
          }
          rows={2}
          maxLength={GOAL_MAX}
          disabled={disabled}
          placeholder="예: 가성비 vs 프리미엄 선택 기준 이해"
          className="resize-none text-md"
        />
      </Field>

      <Field
        label="핵심 가설"
        description="검증 / 반증 대상 (한 줄씩, Enter 로 추가)"
      >
        <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
          {hypotheses.map((h, idx) => (
            <span
              key={`${idx}-${h}`}
              className="inline-flex items-center gap-1 rounded-pill border border-amore bg-white px-2.5 py-0.5 text-xs text-amore"
            >
              {h}
              <IconButton
                variant="ghost-brand"
                onClick={() => removeHypothesis(idx)}
                aria-label={`가설 제거: ${h}`}
                disabled={disabled}
              >
                ×
              </IconButton>
            </span>
          ))}
          <ChipInput
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, HYPOTHESIS_MAX))}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) commitDraft();
            }}
            disabled={disabled || hypotheses.length >= HYPOTHESES_COUNT_MAX}
            placeholder={
              hypotheses.length === 0
                ? '가설 추가 (Enter)'
                : hypotheses.length >= HYPOTHESES_COUNT_MAX
                  ? `최대 ${HYPOTHESES_COUNT_MAX}개`
                  : '+ 가설 추가'
            }
            className="min-w-[140px] flex-1"
          />
        </div>
      </Field>
    </section>
  );
}
