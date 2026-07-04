'use client';

/* ────────────────────────────────────────────────────────────────────
   QuestionPane — probing 위젯 우패널.

   PR (probing-question-thinking-flow): 옛 단일 질문 list UI 를 폐기하고
   **4-layer** 구조로 재편 — A (입력) / B (AI 사고 흐름) / C (popup,
   absolute floating) / D (history).

   부모 (probing-card.tsx) 가 모든 state 와 SSE consumer 를 보유. 본
   컴포넌트는 layout + props pass-through 만.
   ──────────────────────────────────────────────────────────────────── */

import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import type {
  HistoryQuestion,
  PopupQuestion,
  ResearchContext,
  ThinkingEvent,
} from '../probing-types';
import { ProbingResearchContext } from './research-context';
import { ProbingThinkingStream } from './thinking-stream';
import { ProbingQuestionPopup } from './question-popup';
import { ProbingQuestionHistory } from './question-history';

export function QuestionPane({
  context,
  onContextChange,
  contextDisabled,
  thinkingEvents,
  thinkingStreaming,
  thinkCanRun,
  onManualThink,
  activePopup,
  onPopupPin,
  onPopupCopy,
  onPopupDismiss,
  onPopupAutoDismiss,
  history,
  nowMs,
  onHistoryCopy,
  onHistoryToggleStar,
  onHistoryDelete,
  isLive,
  hasTranscript,
}: {
  // A. 입력
  context: ResearchContext;
  onContextChange: (next: ResearchContext) => void;
  contextDisabled: boolean;
  // B. 사고 흐름
  thinkingEvents: ThinkingEvent[];
  thinkingStreaming: boolean;
  thinkCanRun: boolean;
  onManualThink: () => void;
  // C. popup
  activePopup: PopupQuestion | null;
  onPopupPin: () => void;
  onPopupCopy: () => void;
  onPopupDismiss: () => void;
  onPopupAutoDismiss: () => void;
  // D. history
  history: HistoryQuestion[];
  nowMs: number;
  onHistoryCopy: (text: string) => void;
  onHistoryToggleStar: (id: string) => void;
  onHistoryDelete: (id: string) => void;
  // session 상태
  isLive: boolean;
  hasTranscript: boolean;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SectionLabel>검증·probing 질문</SectionLabel>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onManualThink}
          disabled={!thinkCanRun}
          loading={thinkingStreaming}
          loadingLabel="생각 중…"
          className="uppercase tracking-[0.18em]"
          title="지금 한 번 더 생각해줘"
        >
          한 번 더 생각
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ProbingResearchContext
          researchGoal={context.research_goal}
          hypotheses={context.hypotheses}
          onResearchGoalChange={(v) =>
            onContextChange({ ...context, research_goal: v })
          }
          onHypothesesChange={(v) =>
            onContextChange({ ...context, hypotheses: v })
          }
          disabled={contextDisabled}
        />

        <ProbingThinkingStream
          events={thinkingEvents}
          isStreaming={thinkingStreaming}
        />

        {!isLive && thinkingEvents.length === 0 && history.length === 0 && (
          <div className="mx-4 my-4 rounded-xs border-[2px] border-line-soft bg-paper-soft px-4 py-6 text-center text-sm text-mute">
            세션을 시작하면 AI 가 사고 흐름과 즉시 질문을 보내기 시작합니다.
          </div>
        )}
        {isLive && !hasTranscript && thinkingEvents.length === 0 && (
          <div className="mx-4 my-4 rounded-xs border-[2px] border-line-soft bg-paper-soft px-4 py-6 text-center text-sm text-mute">
            발화가 들어오면 AI 가 즉시 사고하기 시작합니다.
          </div>
        )}
      </div>

      <ProbingQuestionHistory
        history={history}
        nowMs={nowMs}
        onCopy={onHistoryCopy}
        onToggleStar={onHistoryToggleStar}
        onDelete={onHistoryDelete}
      />

      {activePopup && (
        <ProbingQuestionPopup
          popup={activePopup}
          placement="bottom-right"
          positioning="viewport"
          onPin={onPopupPin}
          onCopy={onPopupCopy}
          onDismiss={onPopupDismiss}
          onAutoDismiss={onPopupAutoDismiss}
        />
      )}
    </div>
  );
}
