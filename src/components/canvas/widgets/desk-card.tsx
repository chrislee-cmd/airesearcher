'use client';

import type { WidgetContent } from '../widget-types';
// 통합 SSOT #1114 (AUTHORITY §D) — 프레젠테이션 fresh 신규 빌드. 옛
// desk-card-body 는 superseded(삭제). 새 CD 프레젠테이션 = desk/desk-setup-body.
import { DeskSetupBody } from './desk/desk-setup-body';

export const deskCard: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    // WIDGET-SHELL Frame spec — Desk 아이덴티티 cyan(#bfe9ef, Probing sky 와
    // 구분). frame:'v3' 로 canvas-board 가 WidgetShellV3(전용토큰 radius20·
    // 3px·cyan 헤더·단일 툴바 pill·ink CTA)로 렌더.
    accent: 'cyan',
    frame: 'v3',
    cost: 75,
    thumbnail: '/thumbnail/deskresearch.png',
    description: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: DeskSetupBody,
};
