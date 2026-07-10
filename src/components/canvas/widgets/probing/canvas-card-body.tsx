'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingCanvasCardBody — probing 위젯의 canvas card (preview) 본문.

   PR (probing-widgetview-strip-live-surfaces): 라이브 위젯뷰를 정리 —
   **AI 사고 흐름 (ProbingThinkingStream) + 제안 질문 팝업 (ProbingQuestionPopup
   + "질문 준비 중" placeholder)** 을 위젯뷰에서 제거. 이 둘은 전체보기
   (ProbingFullView → QuestionPane) 에서만 노출된다 (사용자 요청: "라이브 중
   위젯뷰에서 사고 흐름·질문 팝업 제거, 전체보기에서만").

   → 라이브 위젯뷰 = **컴팩트 진행 안내 + 전체보기 CTA** + 질문 기록 (history).
   질문 기록은 라이브 busy surface 가 아니라 기록이므로 위젯뷰에 유지.

   세션/think 엔진·질문 생성·popup 상태·thinkingEvents 데이터 로직은 전부
   그대로 (부모 probing-card.tsx ExpandedBody 가 단일 소유) — 표시 위치만
   이동한다. thinkingEvents/activePopup 는 전체보기 QuestionPane 이 이미
   props 로 받아 렌더하므로 여기선 더 이상 전달받지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import { Button } from '@/components/ui/button';
import { ProbingQuestionHistory } from './question-history';
import type { HistoryQuestion } from '../probing-types';

export function ProbingCanvasCardBody({
  history,
  nowMs,
  onHistoryCopy,
  onHistoryToggleStar,
  onHistoryDelete,
  isLive,
  onFullview,
}: {
  // 질문 기록 (위젯뷰 유지)
  history: HistoryQuestion[];
  nowMs: number;
  onHistoryCopy: (text: string) => void;
  onHistoryToggleStar: (id: string) => void;
  onHistoryDelete: (id: string) => void;
  // session 상태 — 중앙 안내 문구 분기
  isLive: boolean;
  // 전체보기 진입 CTA
  onFullview: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 진행 안내 — 사고 흐름·제안 질문 팝업은 전체보기로 이전됨. 위젯뷰는
          컴팩트 진행 상태 + 전체보기 진입만 노출. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-3 text-center">
        <p className="text-sm italic text-mute-soft">
          {isLive
            ? '세션 진행 중 · 전체 보기에서 AI 사고 흐름과 제안 질문을 확인하세요'
            : '세션을 시작하세요'}
        </p>
        {isLive && (
          <Button variant="secondary" size="sm" onClick={onFullview}>
            전체 보기 열기
          </Button>
        )}
      </div>

      {/* 질문 기록 — 하단 toggle (위젯뷰 유지) */}
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
