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
   **"추가 질문 주입"** 진입점으로 재편. 입력 후 명시적 **"주입" 버튼**(또는
   Enter) 을 눌러야만 동작하며, 누를 때 부모의 `onInject(question)` 를 1회
   호출한다. 부모는 이 1회 호출로 (A) 좌 grid 에 위젯 생성 + (B) AI think 에
   **one-shot** 주입을 함께 처리한다. 옛 "핵심 가설" 의 영구 재주입 (매 think
   갱신마다 hypotheses 재전송) 동작은 제거됐다 — 주입은 갱신과 무관하게 사용자
   행동 시점에만 일어난다.

   영속화: research_context (research_goal 등) 는 부모 (probing-card) 가 GET/PUT
   `/api/probing/research-context`. 주입 질문은 여기서 state 로 안 들고 있고
   (one-shot), 부모가 좌 위젯 + think 로 흘려보낸다.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type KeyboardEvent } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/ui/chip-input';
import { Button } from '@/components/ui/button';

const GOAL_MAX = 2_000;
const QUESTION_MAX = 500;

export function ProbingResearchContext({
  researchGoal,
  onResearchGoalChange,
  onInject,
  disabled = false,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  // "주입" 버튼 (또는 Enter) 클릭 시 1회 호출. 갱신과 무관.
  onInject: (question: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const canInject = draft.trim().length > 0 && !disabled;

  function inject() {
    const value = draft.trim().slice(0, QUESTION_MAX);
    if (!value) return;
    onInject(value);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inject();
    }
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
        label="추가 질문 주입"
        description="응답자에게 즉시 던질 질문 — '주입' 을 눌러 AI 질문 popup + 좌측 위젯으로 1회 반영"
      >
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
            <ChipInput
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, QUESTION_MAX))}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="예: 제품을 발견했던, 구매했던 채널이 왜 달랐나요?"
              className="min-w-[140px] flex-1"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={inject}
            disabled={!canInject}
            title="입력한 질문을 지금 주입 (AI popup + 좌측 위젯)"
          >
            주입
          </Button>
        </div>
      </Field>
    </section>
  );
}
