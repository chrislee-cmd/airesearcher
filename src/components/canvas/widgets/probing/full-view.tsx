'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingFullView — probing 위젯의 전체보기 모드.

   widget 카드의 좁은 좌/우 2-pane 외에 풀스크린 모달로 같은 데이터를
   더 넓게 보기 위한 layout. ReflectionPane / QuestionPane 은 widget
   모드와 동일 인스턴스를 props 로 받아 그대로 표시 — state 는 부모
   (probing-card.tsx ExpandedBody) 가 단일 소유. 모달 close 시 state
   유실 없음.

   PR (probing-persona-panels): 페르소나 8 패널 그리드를 더 넓게 보여주기
   위해 좌패널 (페르소나) 에 공간을 더 할당 — lg 이상에서 5:3 비율.
   기존 3-column placeholder 컬럼은 제거 (사용자 요청: "응답자 페르소나
   + probing 질문 두 패널만"). lg 이하 width 에서는 1-column stack.
   ──────────────────────────────────────────────────────────────────── */

import { ReflectionPane } from './reflection-pane';
import { QuestionPane } from './question-pane';
import type { ComponentProps } from 'react';

type ReflectionProps = ComponentProps<typeof ReflectionPane>;
type QuestionProps = ComponentProps<typeof QuestionPane>;

// 헤더 (제목 + 닫기) 는 WidgetFullviewPanel 이 소유 (공유 모달 chrome) —
// 이 컴포넌트는 2-column 본문만 렌더한다.
export function ProbingFullView({
  reflectionProps,
  questionProps,
}: {
  reflectionProps: ReflectionProps;
  questionProps: QuestionProps;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {/* 본문 — lg 이상에서 페르소나 (5fr) / 질문 (3fr) 2-column. 페르소나
          8 패널을 더 넓게 표시. 미만에서는 1-column stack (페르소나 → 질문).
          각 column 은 h-full + min-h-0 로 자기 영역만 스크롤 (widget scroll
          isolation 패턴 동일). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-line-soft overflow-hidden lg:grid-cols-[5fr_3fr] lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <ReflectionPane {...reflectionProps} />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <QuestionPane {...questionProps} />
        </div>
      </div>
    </div>
  );
}
