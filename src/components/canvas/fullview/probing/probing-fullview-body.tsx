'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingFullviewBody — 풀뷰 V2 Probing 본문 (CD state 01 · 02).
   design-handoff/FULLVIEW-SHELL.md §F4 · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 probing/full-view.tsx · question-pane.tsx 는 supersede).
   FullviewShell 우측 슬롯(헤더 아래)에 portal 되는 본문 = 좌 페르소나 그리드
   (flex:5) + 우 thinking/history 레일(flex:3), 그리고 high-importance 질문이
   도착하면 본문 위 Spotlight 모달(state 02).

   activePopup 흐름은 부모(probing-card)가 단일 소유 — 이 본문은 표시만:
   - importance='high' → Spotlight 모달(state 02) + 뒤 본문 blur.
   - medium/low → CD 상 Spotlight 없음. 다만 15s auto-dismiss 로 history 에
     흘러가도록 headless 타이머만 구동(레거시 question-popup 자동 dismiss 계약
     보존, 시각 표출 없음).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { ProbingPersonaGrid, type ProbingReflectionData } from './probing-persona-grid';
import { ProbingThinkingRail } from './probing-thinking-rail';
import { ProbingSpotlight } from './probing-spotlight';
import { ProbingFullviewInject } from './probing-fullview-inject';
import type { ProbingBackfillFeedback } from '../../widgets/probing/inject-field';
import type {
  HistoryQuestion,
  PopupQuestion,
  ProbingCustomSection,
  ThinkingEvent,
} from '../../widgets/probing-types';

const NON_HIGH_AUTO_DISMISS_MS = 15_000;

// medium/low popup 을 CD 상 표출 없이 15s 후 history 로 흘려보내는 headless
// 타이머 (부모 onPopupAutoDismiss 미러). 시각 렌더 없음.
function NonHighAutoDismiss({
  popupId,
  onAutoDismiss,
}: {
  popupId: string;
  onAutoDismiss: () => void;
}) {
  const cbRef = useRef(onAutoDismiss);
  useEffect(() => {
    cbRef.current = onAutoDismiss;
  }, [onAutoDismiss]);
  useEffect(() => {
    const id = setTimeout(() => cbRef.current(), NON_HIGH_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [popupId]);
  return null;
}

export function ProbingFullviewBody({
  reflection,
  customSections,
  hiddenKeys,
  isLive,
  hasTranscript,
  gridRef,
  onInject,
  injectDisabled = false,
  backfillFeedback = null,
  thinkingEvents,
  thinkingStreaming,
  history,
  nowMs,
  onHistoryCopy,
  onHistoryToggleStar,
  onHistoryDelete,
  activePopup,
  onPopupCopy,
  onPopupPin,
  onPopupDismiss,
  onPopupAutoDismiss,
}: {
  // 페르소나 그리드
  reflection: ProbingReflectionData | null;
  customSections: ProbingCustomSection[];
  hiddenKeys: Set<string>;
  isLive: boolean;
  hasTranscript: boolean;
  gridRef?: React.Ref<HTMLDivElement>;
  // "추가 질문 주입" — rail 상단 필드. onInject = handleInjectQuestion(호스트)
  // 로 좌 grid 위젯 생성 + backfill + AI think one-shot (일반 위젯과 동일 배선).
  onInject: (question: string) => void;
  injectDisabled?: boolean;
  backfillFeedback?: ProbingBackfillFeedback | null;
  // thinking rail
  thinkingEvents: ThinkingEvent[];
  thinkingStreaming: boolean;
  history: HistoryQuestion[];
  nowMs: number;
  onHistoryCopy: (text: string) => void;
  onHistoryToggleStar: (id: string) => void;
  onHistoryDelete: (id: string) => void;
  // spotlight (activePopup)
  activePopup: PopupQuestion | null;
  onPopupCopy: () => void;
  onPopupPin: () => void;
  onPopupDismiss: () => void;
  onPopupAutoDismiss: () => void;
}) {
  const showSpotlight = activePopup?.importance === 'high';

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* 본문 — spotlight 활성 시 blur/dim (CD state 02). */}
      <div
        className={`flex min-h-0 flex-1 ${
          showSpotlight ? 'pointer-events-none opacity-[0.55] blur-[2px]' : ''
        }`}
      >
        <ProbingPersonaGrid
          data={reflection}
          customSections={customSections}
          hiddenKeys={hiddenKeys}
          isLive={isLive}
          hasTranscript={hasTranscript}
          gridRef={gridRef}
        />
        {/* 우 rail 컬럼 = "추가 질문 주입" 필드(상단) + thinking/history 레일.
            legacy question-pane 에서 inject 가 우패널 상단(thinking 위)에 있던
            배치를 미러 — V2 는 goal 편집이 컨트롤 패널로 이전돼 rail 최상단이
            자연스러운 자리. ThinkingRail(flex-[3]) 은 그대로, body 에서 감싼다. */}
        <div className="flex min-h-0 flex-[3] flex-col bg-paper">
          <ProbingFullviewInject
            onInject={onInject}
            disabled={injectDisabled}
            backfillFeedback={backfillFeedback}
          />
          <ProbingThinkingRail
            thinkingEvents={thinkingEvents}
            thinkingStreaming={thinkingStreaming}
            history={history}
            nowMs={nowMs}
            onHistoryCopy={onHistoryCopy}
            onHistoryToggleStar={onHistoryToggleStar}
            onHistoryDelete={onHistoryDelete}
          />
        </div>
      </div>

      {showSpotlight && activePopup && (
        <ProbingSpotlight
          // 새 popup 마다 리마운트 → 카운트다운 15s 로 fresh 초기화.
          key={activePopup.id}
          popup={activePopup}
          onCopy={onPopupCopy}
          onPin={onPopupPin}
          onDismiss={onPopupDismiss}
          onAutoDismiss={onPopupAutoDismiss}
        />
      )}
      {activePopup && !showSpotlight && (
        <NonHighAutoDismiss
          popupId={activePopup.id}
          onAutoDismiss={onPopupAutoDismiss}
        />
      )}
    </div>
  );
}
