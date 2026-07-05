'use client';

import type { WidgetContent } from '../widget-types';
import { ComingSoonBody } from './coming-soon-body';

// PPT 보고서 생성기 — Row 3 우측. 옛 'slidegen' (보고서→슬라이드 뼈대) 와
// 별개 신 위젯. 현재 placeholder — 카드 안은 짧은 "준비 중", 전체보기는
// 기능 소개 hero (ComingSoonBody). 실 본문은 후속 spec 에서 교체.
export const pptReportCard: WidgetContent = {
  key: 'ppt_report',
  meta: {
    label: 'PPT 보고서 생성기',
    accent: 'rose',
    cost: 0,
    description: '인터뷰 결과를 PPT 보고서로 정리해요',
  },
  state: 'idle',
  ExpandedBody: () => (
    <ComingSoonBody
      widgetKey="ppt_report"
      label="PPT 보고서 생성기"
      icon="📊"
      title="PPT 보고서 생성기가 곧 만나요"
      description="인터뷰 결과와 데스크 리서치 결과를 모아 AI가 발표용 PPT 보고서를 자동 생성해요. 표지부터 appendix까지 완결."
      features={[
        '표지 / 요약 / 인사이트 / 증거 인용 / appendix 자동 구성',
        '데이터 시각화 (차트 / 표) 자동 삽입',
        '인터뷰 원문 인용 자동 링크',
        'PPTX 파일 다운로드',
      ]}
    />
  ),
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
