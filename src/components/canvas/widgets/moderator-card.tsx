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
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051). 영문 기본 라벨.
    label: 'AI Moderator',
    labelKey: 'Features.moderator.title',
    accent: 'peach',
    cost: 1,
    thumbnail: '/thumbnail/interview.png',
    description: '인터뷰 가이드 자동 생성 + 실시간 모더레이션 보조',
  },
  state: 'idle',
  ExpandedBody,
};
