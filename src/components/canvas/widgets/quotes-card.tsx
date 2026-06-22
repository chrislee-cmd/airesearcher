'use client';

import type { WidgetContent } from '../widget-types';
import { QuotesCardBody } from './quotes-card-body';

export const quotesCard: WidgetContent = {
  key: 'quotes',
  meta: {
    label: '전사록 생성기',
    accent: 'lav',
    cost: 25,
    thumbnail: '/thumbnail/transcript.png',
    description: '오디오·영상 인터뷰를 정확한 전사록(Verbatim)으로 변환합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: QuotesCardBody,
};
