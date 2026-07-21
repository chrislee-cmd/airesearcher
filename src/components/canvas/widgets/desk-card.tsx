'use client';

import type { WidgetContent } from '../widget-types';
import { DeskCardBody } from './desk-card-body';

export const deskCard: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    // CD 파일럿 #2 — Desk 아이덴티티 cyan(#bfe9ef, Probing sky 와 구분).
    // pastelHeader opt-in 으로 헤더 밴드가 노란 기본 대신 cyan 파스텔.
    accent: 'cyan',
    pastelHeader: true,
    cost: 75,
    thumbnail: '/thumbnail/deskresearch.png',
    description: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: DeskCardBody,
};
