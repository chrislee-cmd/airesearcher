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
    // Canvas 1c 카드 프레임 opt-in — 604×900 카드 + lav 파스텔 헤더밴드 +
    // 통합 툴바(💎25). interpreter(translate-card) 와 동일 프레임 상속.
    cardFrame: true,
    // 풀뷰 V2 opt-in (pr-fullview-transcript) — 캔버스 전체보기를 레거시 모달
    // 대신 공유 FullviewShell(§F1~F3)로 렌더. body = fresh TranscriptFullviewBody
    // (파일 리스트 state 04 · 상세 state 05 + AI 요약/테마 백엔드).
    fullviewV2: true,
  },
  state: 'idle',
  ExpandedBody: QuotesCardBody,
};
