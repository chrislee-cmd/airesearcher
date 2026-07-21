'use client';

import type { WidgetContent } from '../widget-types';
import { QuotesCardBody } from './quotes-card-body';

export const quotesCard: WidgetContent = {
  key: 'quotes',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051 회귀). 영문 기본 라벨.
    label: 'Transcript Generator',
    labelKey: 'Features.quotes.title',
    accent: 'lav',
    cost: 25,
    thumbnail: '/thumbnail/transcript.png',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: QuotesCardBody,
};
