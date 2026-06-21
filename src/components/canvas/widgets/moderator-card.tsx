'use client';

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        PR2 에서 <strong className="text-ink-2">AI 모더레이터</strong>{' '}
        본문(가이드 생성 + 실시간 대화 인터페이스) 이 합쳐집니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const moderatorCard: WidgetContent = {
  key: 'moderator',
  meta: { label: 'AI 모더레이터', accent: 'peach', cost: 1 },
  state: 'idle',
  ExpandedBody,
};
