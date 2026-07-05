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
};
