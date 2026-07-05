'use client';

import type { WidgetContent } from '../widget-types';
import { ComingSoonBody } from './coming-soon-body';

// AI 모더레이터 — Row 2 우측. 옛 'moderator' (휴먼 감수자) 와 별개 신 위젯.
// 현재 placeholder — 카드 안은 짧은 "준비 중", 전체보기는 기능 소개 hero
// (ComingSoonBody). 실 본문은 후속 spec 에서 교체.
export const moderatorAiCard: WidgetContent = {
  key: 'moderator_ai',
  meta: {
    label: 'AI 모더레이터',
    accent: 'mint',
    cost: 0,
    description: 'AI 모더레이터가 자동 진행해요',
  },
  state: 'idle',
  ExpandedBody: () => (
    <ComingSoonBody
      widgetKey="moderator_ai"
      label="AI 모더레이터"
      icon="🎙"
      title="AI 모더레이터가 곧 만나요"
      description="가이드라인과 실시간 대화 컨텍스트를 바탕으로 AI가 자동으로 인터뷰를 진행해요. 동시통역과 프로빙 어시스턴트가 하나로."
      features={[
        '가이드라인 기반 자동 질문 진행',
        '실시간 답변 → 후속 질문 자동 생성 (프로빙)',
        '동시통역 지원 (다국어 인터뷰)',
        '인터뷰 종료 자동 판단 + 요약 생성',
      ]}
    />
  ),
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
