'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">전체 리포트 생성기</strong>{' '}
        본문(전사록·인터뷰 결과 input + 보고서 생성 + 미리보기) 이
        합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const toplineCard: WidgetContent = {
  key: 'topline',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051). 영문 기본 라벨.
    // key 는 topline 이지만 번역 키는 Features.reports (Features.topline 없음).
    label: 'Full Report Generator',
    labelKey: 'Features.reports.title',
    accent: 'rose',
    cost: 50,
    description: '전사록·인터뷰 결과를 종합해 한 페이지 토플라인 보고서로',
  },
  state: 'idle',
  ExpandedBody,
};
