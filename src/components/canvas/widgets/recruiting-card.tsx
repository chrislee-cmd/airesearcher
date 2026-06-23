'use client';

import type { WidgetContent } from '../widget-types';
import { RecruitingBrief } from '@/components/recruiting-brief';

function ExpandedBody() {
  return (
    <div className="space-y-5 px-5 py-5">
      <RecruitingBrief />
    </div>
  );
}

// 리크루팅 canvas widget — 기존 /recruiting 페이지의 RecruitingBrief 를
// widget body 로 그대로 마운트. PREVIEW_FEATURES 에 속해 canvas/page.tsx
// 의 server-side preview gate 가 일반 유저에게 자동 숨김.
export const recruitingCard: WidgetContent = {
  key: 'recruiting',
  meta: {
    label: '리크루팅',
    accent: 'sun',
    cost: 10,
    thumbnail: '/thumbnail/recruiting.png',
    description:
      '리서치 목적·페르소나·문항 초안을 LLM 으로 한 번에 생성합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
