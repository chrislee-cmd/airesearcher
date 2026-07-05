'use client';

import type { WidgetContent } from '../widget-types';
import { PlaceholderBody } from './placeholder-card';

// PPT 보고서 생성기 — Row 3 우측. 옛 'slidegen' (보고서→슬라이드 뼈대) 와
// 별개 신 위젯. 현재 placeholder ("준비 중"). 실 본문은 후속 spec 에서 교체.
export const pptReportCard: WidgetContent = {
  key: 'ppt_report',
  meta: {
    label: 'PPT 보고서 생성기',
    accent: 'rose',
    cost: 0,
    description: '인터뷰 결과를 PPT 보고서로 정리해요',
  },
  state: 'idle',
  ExpandedBody: PlaceholderBody,
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
