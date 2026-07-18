'use client';

/* ────────────────────────────────────────────────────────────────────
   QuestionPane — probing 위젯 우패널.

   PR (probing-question-thinking-flow): 옛 단일 질문 list UI 를 폐기하고
   **4-layer** 구조로 재편 — A (입력) / B (AI 사고 흐름) / C (popup,
   absolute floating) / D (history).

   부모 (probing-card.tsx) 가 모든 state 와 SSE consumer 를 보유. 본
   컴포넌트는 layout + props pass-through 만.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import type {
  HistoryQuestion,
  PopupQuestion,
  ResearchContext,
  ThinkingEvent,
} from '../probing-types';
import {
  ProbingResearchContext,
  type ProbingBackfillFeedback,
} from './research-context';
import { ProbingThinkingStream } from './thinking-stream';
import { ProbingQuestionPopup } from './question-popup';
import { ProbingQuestionHistory } from './question-history';

export function QuestionPane({
  context,
  onContextChange,
  onInject,
  backfillFeedback,
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
  onInject: (question: string) => void;
  backfillFeedback: ProbingBackfillFeedback | null;
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
  // 전체보기(fullview) 모달이 이 probing 위젯을 보여주는 중이면 제안 질문
  // popup 을 화면 정중앙 대형 스포트라이트로. QuestionPane 은 현재 fullview
  // slot 안에서만 렌더되지만, 혹여 다른 곳에 마운트돼도 isCurrent=false 로
  // 안전하게 현행 compact/우하단으로 폴백한다(사용자 요구는 "전체보기" 한정).
  const { isCurrent: isFullview } = useFullview('probing');
  const t = useTranslations('Probing');
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SectionLabel>{t('question.paneTitle')}</SectionLabel>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onManualThink}
          disabled={!thinkCanRun}
          loading={thinkingStreaming}
          loadingLabel={t('question.thinkingShort')}
          className="uppercase tracking-[0.18em]"
          title={t('question.thinkAgainTitle')}
        >
          {t('question.thinkAgain')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ProbingResearchContext
          researchGoal={context.research_goal}
          onResearchGoalChange={(v) =>
            onContextChange({ ...context, research_goal: v })
          }
          onInject={onInject}
          backfillFeedback={backfillFeedback}
          disabled={contextDisabled}
        />

        <ProbingThinkingStream
          events={thinkingEvents}
          isStreaming={thinkingStreaming}
        />

        {!isLive && thinkingEvents.length === 0 && history.length === 0 && (
          <div className="mx-4 my-4 rounded-xs border-2 border-line-soft bg-paper-soft px-4 py-6 text-center text-sm text-mute">
            {t('question.emptyNotLive')}
          </div>
        )}
        {isLive && !hasTranscript && thinkingEvents.length === 0 && (
          <div className="mx-4 my-4 rounded-xs border-2 border-line-soft bg-paper-soft px-4 py-6 text-center text-sm text-mute">
            {t('question.emptyLiveNoTranscript')}
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
          placement={isFullview ? 'center' : 'bottom-right'}
          positioning="viewport"
          size={isFullview ? 'spotlight' : 'compact'}
          onPin={onPopupPin}
          onCopy={onPopupCopy}
          onDismiss={onPopupDismiss}
          onAutoDismiss={onPopupAutoDismiss}
        />
      )}
    </div>
  );
}
