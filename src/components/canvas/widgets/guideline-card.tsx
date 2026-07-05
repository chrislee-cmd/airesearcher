'use client';

import type { WidgetContent } from '../widget-types';
import { ComingSoonBody } from './coming-soon-body';

// 가이드라인 생성기 — Row 1 우측. 현재 placeholder — 카드 안은 짧은 "준비
// 중", 전체보기는 기능 소개 hero (ComingSoonBody). 실 본문은 후속 spec
// (인터뷰 가이드라인 자동 생성 input/output) 에서 교체.
export const guidelineCard: WidgetContent = {
  key: 'guideline',
  meta: {
    label: '가이드라인 생성기',
    accent: 'sun',
    cost: 0,
    description: '인터뷰 가이드라인을 자동 생성해요',
  },
  state: 'idle',
  ExpandedBody: () => (
    <ComingSoonBody
      widgetKey="guideline"
      label="가이드라인 생성기"
      icon="📋"
      title="가이드라인 생성기가 곧 만나요"
      description="조사 목적과 대상자 특성만 입력하면 AI가 반구조화 인터뷰 가이드라인을 자동 생성해요. 오프너부터 딥다이브까지 흐름 있게."
      features={[
        '조사 목적 + 대상자 특성 → 질문 자동 매핑',
        '오프너 / 워밍업 / 핵심 / 딥다이브 / 클로징 구조 자동 배치',
        '질문 유형 균형 (개방형 / 폐쇄형 / 프로빙) 자동 조율',
        'Word / PDF 다운로드 지원',
      ]}
    />
  ),
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
