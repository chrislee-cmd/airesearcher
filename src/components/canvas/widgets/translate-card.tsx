'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">AI 동시통역</strong>{' '}
        본문(실시간 STT + 번역 듀얼 패널) 이 합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const translateCard: WidgetContent = {
  key: 'translate',
  meta: { label: 'AI 동시통역', accent: 'mint', cost: 50 },
  state: 'idle',
  ExpandedBody,
};
