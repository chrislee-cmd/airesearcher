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
    description: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
  },
  state: 'idle',
  ExpandedBody: DeskCardBody,
};
