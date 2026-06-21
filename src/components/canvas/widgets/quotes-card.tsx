'use client';

import type { WidgetContent } from '../widget-types';
import { QuotesCardBody } from './quotes-card-body';

export const quotesCard: WidgetContent = {
  key: 'quotes',
  meta: { label: '전사록 생성기', accent: 'lav', cost: 25 },
  state: 'idle',
  ExpandedBody: QuotesCardBody,
};
