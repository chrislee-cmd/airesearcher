'use client';

import type { WidgetContent } from '../widget-types';
import { QuotesCardBody } from './quotes-card-body';

export const quotesCard: WidgetContent = {
  key: 'quotes',
  meta: {
    labelKey: 'Features.quotes.title',
    accent: 'lav',
    cost: 25,
    thumbnail: '/thumbnail/transcript.png',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: QuotesCardBody,
};
