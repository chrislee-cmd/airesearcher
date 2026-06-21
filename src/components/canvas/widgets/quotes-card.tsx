'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">전사록 생성기</strong>{' '}
        본문(FileDropZone + 잡 큐 + 최근 산출물) 이 이 자리로 합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const quotesCard: WidgetContent = {
  key: 'quotes',
  meta: { label: '전사록 생성기', accent: 'lav', cost: 25 },
  state: 'idle',
  ExpandedBody,
};
