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

import { IconButton } from '@/components/ui/icon-button';
import { ReflectionPane } from './reflection-pane';
import { QuestionPane } from './question-pane';
import type { ComponentProps } from 'react';

type ReflectionProps = ComponentProps<typeof ReflectionPane>;
type QuestionProps = ComponentProps<typeof QuestionPane>;

export function ProbingFullView({
  reflectionProps,
  questionProps,
  onClose,
}: {
  reflectionProps: ReflectionProps;
  questionProps: QuestionProps;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {/* 헤더 — 전체보기 표시 + close. dragHandle 영역 아님 (모달 안). */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            전체보기
          </span>
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
            프로빙 어시스턴트
          </h2>
        </div>
        <IconButton
          aria-label="전체보기 닫기"
          variant="ghost"
          size="md"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </IconButton>
      </div>

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
