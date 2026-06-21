'use client';

import type { WidgetContent } from '../widget-types';
import { DeskCardBody } from './desk-card-body';

export const deskCard: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    accent: 'sky',
    cost: 25,
    thumbnail: '/thumbnail/deskresearch.png',
  },
  state: 'idle',
  ExpandedBody: DeskCardBody,
};
