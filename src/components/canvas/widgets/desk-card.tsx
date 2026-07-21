'use client';

import type { WidgetContent } from '../widget-types';
import { DeskCardBody } from './desk-card-body';

export const deskCard: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    accent: 'cyan',
    cost: 75,
    thumbnail: '/thumbnail/deskresearch.png',
    description: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
    expandedCols: 3,
    // Canvas 1c 카드 프레임 opt-in — probing·interpreter 와 동일 공유 셸
    // (파스텔 cyan 헤더밴드 + 통합 툴바 💎75).
    cardFrame: true,
  },
  state: 'idle',
  ExpandedBody: DeskCardBody,
};
