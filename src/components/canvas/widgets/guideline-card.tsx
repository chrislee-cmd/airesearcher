'use client';

import type { WidgetContent } from '../widget-types';
import { PlaceholderBody } from './placeholder-card';

// 가이드라인 생성기 — Row 1 우측. 현재 placeholder ("준비 중"). 실 본문은
// 후속 spec (인터뷰 가이드라인 자동 생성 input/output) 에서 교체.
export const guidelineCard: WidgetContent = {
  key: 'guideline',
  meta: {
    label: '가이드라인 생성기',
    accent: 'sun',
    cost: 0,
    description: '인터뷰 가이드라인을 자동 생성해요',
  },
  state: 'idle',
  ExpandedBody: PlaceholderBody,
  // "준비 중" placeholder — dim 처리로 옛 실기능 위젯과 시각 구분. 실 본문
  // 교체 spec 에서 이 플래그 제거 시 즉시 정상 활성.
  dimmed: true,
};
