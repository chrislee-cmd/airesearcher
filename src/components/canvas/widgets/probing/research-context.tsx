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

import { useState } from 'react';
import { Field } from '@/components/canvas/shell/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  ProbingInjectField,
  type ProbingBackfillFeedback,
} from './inject-field';

// 주입 필드는 inject-field 로 추출(호스트·공유 뷰어 공유). 타입은 기존 import
// 경로(이 모듈)를 깨지 않도록 re-export.
export type { ProbingBackfillFeedback };

const GOAL_MAX = 2_000;

export function ProbingResearchContext({
  researchGoal,
  onResearchGoalChange,
  onInject,
  backfillFeedback = null,
  disabled = false,
}: {
  researchGoal: string;
  onResearchGoalChange: (next: string) => void;
  // "주입" 버튼 (또는 Enter) 클릭 시 1회 호출. 갱신과 무관.
  onInject: (question: string) => void;
  // 신규 위젯 backfill 진행/결과 (없으면 미표시).
  backfillFeedback?: ProbingBackfillFeedback | null;
  disabled?: boolean;
}) {
  // 조사 목적 = draft + 명시적 "적용" 버튼 커밋. 타이핑은 goalDraft 만 갱신하고
  // (키 입력마다 자동저장하지 않음), "적용" 클릭 시에만 onResearchGoalChange 를
  // 1회 호출한다. 외부 로드/세션 전환으로 researchGoal prop 이 바뀌면 draft 동기 —
  // effect 대신 render 중 prop 변화 감지로 리셋 (React "adjust state on prop change").
  // (주입 필드 state 는 515 에서 ProbingInjectField 로 추출돼 여기서 안 든다.)
  const [goalDraft, setGoalDraft] = useState(researchGoal);
  const [syncedGoal, setSyncedGoal] = useState(researchGoal);
  if (researchGoal !== syncedGoal) {
    setSyncedGoal(researchGoal);
    setGoalDraft(researchGoal);
  }
  const goalDirty = goalDraft !== researchGoal;
  const canApplyGoal = goalDirty && !disabled;

  function applyGoal() {
    if (!canApplyGoal) return;
    const value = goalDraft.trim().slice(0, GOAL_MAX);
    onResearchGoalChange(value);
    setGoalDraft(value);
  }

  return (
    <section className="space-y-3 border-b-[2px] border-line-soft bg-paper px-4 py-3">
      <Field label="조사 목적">
        <Textarea
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value.slice(0, GOAL_MAX))}
          rows={2}
          maxLength={GOAL_MAX}
          disabled={disabled}
          placeholder="예: 가성비 vs 프리미엄 선택 기준 이해"
          className="resize-none text-md"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-xs text-mute" aria-live="polite">
            {goalDirty ? "미적용 변경 — '적용' 을 눌러 반영" : ''}
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={applyGoal}
            disabled={!canApplyGoal}
            title="입력한 조사 목적을 지금 반영"
          >
            적용
          </Button>
        </div>
      </Field>

      <ProbingInjectField
        onInject={onInject}
        disabled={disabled}
        backfillFeedback={backfillFeedback}
      />
    </section>
  );
}
