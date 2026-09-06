'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">PPT 생성기</strong>{' '}
        본문(보고서 텍스트 input + 도식 슬라이드 덱 미리보기 + export) 이
        합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const slidegenCard: WidgetContent = {
  key: 'slidegen',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051). 영문 기본 라벨.
    label: 'Slide Generator',
    labelKey: 'Features.slidegen.title',
    accent: 'sun',
    cost: 0,
    description: '보고서 텍스트를 도식 슬라이드 덱으로 자동 변환',
  },
  state: 'idle',
  ExpandedBody,
};
