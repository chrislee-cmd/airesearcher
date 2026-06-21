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
  meta: { label: '전체 리포트 생성기', accent: 'rose', cost: 50 },
  state: 'idle',
  ExpandedBody,
};
