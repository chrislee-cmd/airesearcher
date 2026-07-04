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

   PR (probing-question-injection-input-to-widget): 옛 "핵심 가설" 필드를
   **"추가 질문 주입"** 진입점으로 재편. 입력 → Enter → (A) hypotheses state
   에 push (backend think prompt inject 유지) + (B) 좌패널 grid 에 신규 위젯
   생성 (onCreateInjectionWidget). 옛 chip 시각은 제거 — 좌 위젯이 유일한
   시각 표현 (single source). hypotheses 는 화면에 안 보이지만 backend inject
   용으로 계속 누적된다.

   영속화: research_context 는 부모 (probing-card) 가 GET/PUT
   `/api/probing/research-context`. 본 컴포넌트는 controlled props 로 표시 /
   갱신만 한다.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type KeyboardEvent } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/ui/chip-input';

const GOAL_MAX = 2_000;
const HYPOTHESIS_MAX = 500;
const HYPOTHESES_COUNT_MAX = 20;

export function ProbingResearchContext({
  researchGoal,
  hypotheses,
  onResearchGoalChange,
  onHypothesesChange,
  onCreateInjectionWidget,
  disabled = false,
}: {
  researchGoal: string;
  hypotheses: string[];
  onResearchGoalChange: (next: string) => void;
  onHypothesesChange: (next: string[]) => void;
  // 입력 확정 시 좌패널 grid 에 신규 "질문 주입" 위젯을 생성한다.
  onCreateInjectionWidget: (question: string) => void;
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
    const value = trimmed.slice(0, HYPOTHESIS_MAX);
    // A. hypotheses state — backend think prompt inject 유지 (화면엔 안 보임).
    onHypothesesChange([...hypotheses, value]);
    // B. 좌패널 grid 에 신규 위젯 생성 — 유일한 시각 표현.
    onCreateInjectionWidget(value);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    }
  }

  const atMax = hypotheses.length >= HYPOTHESES_COUNT_MAX;

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
        label="추가 질문 주입"
        description="응답자에게 즉시 던질 질문 (Enter 로 위젯 추가)"
      >
        <div className="flex items-center rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
          <ChipInput
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, HYPOTHESIS_MAX))}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) commitDraft();
            }}
            disabled={disabled || atMax}
            placeholder={
              atMax
                ? `최대 ${HYPOTHESES_COUNT_MAX}개`
                : '예: 제품을 발견했던, 구매했던 채널이 왜 달랐나요?'
            }
            className="min-w-[140px] flex-1"
          />
        </div>
      </Field>
    </section>
  );
}
