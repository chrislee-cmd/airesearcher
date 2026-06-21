'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">데스크 리서치</strong>{' '}
        본문(주제·키워드 chip · 출처/기간/형식 토글 · CTA) 이 합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const deskCard: WidgetContent = {
  key: 'desk',
  meta: { label: '데스크 리서치', accent: 'sky', cost: 25 },
  state: 'idle',
  ExpandedBody,
};
