'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingCanvasCardBody — probing 위젯의 canvas card (preview) 본문.

   PR (probing-canvas-card-simplify): canvas card 를 "최소 작업 영역" 으로
   단순화. 3 section 만 노출 —
     1. AI 사고 흐름 (thinking stream) — 상단
     2. 제안 질문 popup — 중앙 절대 위치
     3. 질문 기록 (history) — 하단 toggle

   페르소나 8 패널 + 조사 입력 (조사 목적/가설/KRQ) 은 canvas card 에서
   사라지고 fullview modal (ProbingFullView) 에만 노출 — preview vs fullview
   의 의미를 분리. 백그라운드 페르소나 분석은 계속 (세션 state 는 부모
   probing-card.tsx ExpandedBody 가 단일 소유, 컴포넌트만 다르게 그림).

   popup 은 placement="center" 로 카드 중앙에 띄운다 (fullview 의 우하단
   floating 과 대비 — 좁은 카드는 사용자 시선이 중앙에 머무므로).
   ──────────────────────────────────────────────────────────────────── */

import { ProbingThinkingStream } from './thinking-stream';
import { ProbingQuestionPopup } from './question-popup';
import { ProbingQuestionHistory } from './question-history';
import type {
  HistoryQuestion,
  PopupQuestion,
  ThinkingEvent,
} from '../probing-types';

export function ProbingCanvasCardBody({
  thinkingEvents,
  thinkingStreaming,
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
}: {
  // 1. 사고 흐름
  thinkingEvents: ThinkingEvent[];
  thinkingStreaming: boolean;
  // 2. popup
  activePopup: PopupQuestion | null;
  onPopupPin: () => void;
  onPopupCopy: () => void;
  onPopupDismiss: () => void;
  onPopupAutoDismiss: () => void;
  // 3. history
  history: HistoryQuestion[];
  nowMs: number;
  onHistoryCopy: (text: string) => void;
  onHistoryToggleStar: (id: string) => void;
  onHistoryDelete: (id: string) => void;
  // session 상태 — 중앙 placeholder 문구 분기
  isLive: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 1. AI 사고 흐름 — 상단 */}
      <ProbingThinkingStream
        events={thinkingEvents}
        isStreaming={thinkingStreaming}
      />

      {/* 2. 제안 질문 popup — 중앙 영역 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-3">
        {!activePopup && (
          <p className="text-center text-sm italic text-mute-soft">
            {isLive
              ? 'AI 가 질문을 준비 중입니다…'
              : '세션을 시작하세요'}
          </p>
        )}
        {activePopup && (
          <ProbingQuestionPopup
            popup={activePopup}
            placement="center"
            positioning="card"
            onPin={onPopupPin}
            onCopy={onPopupCopy}
            onDismiss={onPopupDismiss}
            onAutoDismiss={onPopupAutoDismiss}
          />
        )}
      </div>

      {/* 3. 질문 기록 — 하단 toggle */}
      <ProbingQuestionHistory
        history={history}
        nowMs={nowMs}
        onCopy={onHistoryCopy}
        onToggleStar={onHistoryToggleStar}
        onDelete={onHistoryDelete}
      />
    </div>
  );
}
