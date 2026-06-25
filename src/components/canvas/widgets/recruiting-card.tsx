'use client';

import type { WidgetContent } from '../widget-types';
import { RecruitingWizard } from '@/components/recruiting-wizard';

// 본문 = RecruitingWizard (3-step 카드) 만. 이전엔 위젯 바닥에 발행된
// 폼 목록 "최근 산출물" 영역이 있었지만, prod 마이그 lag 로 인한
// forms/list 500/401 폭주 + UX 정리 차원에서 제거. 발행 결과 링크는
// wizard 의 Card 3 발행 완료 패널에서 바로 노출되므로 위젯 바닥의
// 중복 노출이 필요 없음.
function ExpandedBody() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5">
          <RecruitingWizard />
        </div>
      </div>
    </div>
  );
}

// 리크루팅 canvas widget — 3-step 카드 wizard (조건 → 설문 → Google Form)
// 를 widget body 에 마운트. PREVIEW_FEATURES 에 속해 canvas/page.tsx 의
// server-side preview gate 가 일반 유저에게 자동 숨김.
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
