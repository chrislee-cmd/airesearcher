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
    // 풀뷰 V2 (fullviewV2) — CD state 09 fresh 본문(DeskFullviewBody)을 공유
    // FullviewShell 로 렌더. 레거시 <Modal>+WidgetFullviewPanel 경로 대신 신규
    // 셸(프레임+240px 사이드바+§F3 헤더 스캐폴드, 헤더밴드 톤 = accent cyan)로 분기.
    fullviewV2: true,
  },
  state: 'idle',
  ExpandedBody: DeskCardBody,
};
