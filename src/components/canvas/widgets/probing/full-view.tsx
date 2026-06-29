'use client';

/* ────────────────────────────────────────────────────────────────────
   ProbingFullView — probing 위젯의 전체보기 모드.

   widget 카드의 좁은 좌/우 2-pane 외에 풀스크린 모달로 같은 데이터를
   더 넓게 보기 위한 layout. ReflectionPane / QuestionPane 은 widget
   모드와 동일 인스턴스를 props 로 받아 그대로 표시 — state 는 부모
   (probing-card.tsx ExpandedBody) 가 단일 소유. 모달 close 시 state
   유실 없음.

   우측 세 번째 column 은 placeholder — "추가 기능 영역 (기획 중)".
   후속 PR 에서 페르소나 그래프 / hypothesis tracker 등이 들어올
   자리. border-dashed + amore-soft 안내문으로 의도된 빈자리임을
   사용자에게 알린다.

   lg 이하 width 에서는 1-column stack 으로 떨어진다 (성찰 → 질문 →
   placeholder).
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

      {/* 본문 — lg 이상 3-column, 미만 1-column stack. divide-x 로 세로
          divider, gap 0 (각 pane 이 자기 padding 소유). 각 column 은
          h-full + min-h-0 로 자기 영역만 스크롤 (widget scroll isolation
          패턴 동일). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-line-soft overflow-hidden lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <ReflectionPane {...reflectionProps} />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <QuestionPane {...questionProps} />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden bg-paper-soft px-6 py-5">
          <PlaceholderColumn />
        </div>
      </div>
    </div>
  );
}

function PlaceholderColumn() {
  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-sm border-2 border-dashed border-line bg-paper px-6 py-6"
      aria-label="추가 기능 영역 — 기획 중"
    >
      <div className="text-xs uppercase tracking-[0.22em] text-mute-soft">
        추가 기능 영역
      </div>
      <p className="mt-3 text-md leading-[1.7] text-mute">
        추후 추가될 기능이 들어갈 자리입니다 (기획 중).
      </p>
      <ul className="mt-4 space-y-1.5 text-sm leading-[1.6] text-mute-soft">
        <li>· (예시) 응답자 페르소나 그래프</li>
        <li>· (예시) 인터뷰 진행률</li>
        <li>· (예시) hypothesis tracker</li>
      </ul>
      <div className="mt-auto pt-4 text-xs text-mute-soft">
        지금은 빈 영역입니다. 의견은 팀 채널로 알려주세요.
      </div>
    </section>
  );
}
