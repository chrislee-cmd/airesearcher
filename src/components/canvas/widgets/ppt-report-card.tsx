'use client';

import type { WidgetContent } from '../widget-types';
import { ComingSoonBody } from './coming-soon-body';

// 영상 분석기 — Row 3 우측. 옛 'slidegen' (보고서→슬라이드 뼈대) 와
// 별개 신 위젯. key 는 내부 식별자라 'ppt_report' 유지 (표시 라벨만 영상
// 분석기). 현재 placeholder — 카드 안은 짧은 "준비 중", 전체보기는
// 기능 소개 hero (ComingSoonBody). 실 본문은 후속 spec 에서 교체.
export const pptReportCard: WidgetContent = {
  key: 'ppt_report',
  meta: {
    label: '영상 분석기',
    accent: 'rose',
    cost: 0,
    description: '영상을 업로드하면 자동으로 분석해요',
  },
  state: 'idle',
  ExpandedBody: () => (
    <ComingSoonBody
      widgetKey="ppt_report"
      label="영상 분석기"
      icon="🎬"
      title="영상 분석기가 곧 만나요"
      description="인터뷰·사용성 테스트 영상을 업로드하면 AI가 자동으로 발화·행동·주요 장면을 분석해요. 긴 영상도 핵심만 빠르게."
      features={[
        '영상 자동 전사 + 화자 구분',
        '주요 장면 / 하이라이트 자동 추출',
        '발화·행동 기반 인사이트 태깅',
        '타임스탬프별 원본 영상 링크',
      ]}
    />
  ),
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
