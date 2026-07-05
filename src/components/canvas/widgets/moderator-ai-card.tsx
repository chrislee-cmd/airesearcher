'use client';

import type { WidgetContent } from '../widget-types';
import { PlaceholderBody } from './placeholder-card';

// AI 모더레이터 — Row 2 우측. 옛 'moderator' (휴먼 감수자) 와 별개 신 위젯.
// 현재 placeholder ("준비 중"). 실 본문은 후속 spec 에서 교체.
export const moderatorAiCard: WidgetContent = {
  key: 'moderator_ai',
  meta: {
    label: 'AI 모더레이터',
    accent: 'mint',
    cost: 0,
    description: 'AI 모더레이터가 자동 진행해요',
  },
  state: 'idle',
  ExpandedBody: PlaceholderBody,
};
