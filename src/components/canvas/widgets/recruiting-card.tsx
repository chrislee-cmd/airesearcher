'use client';

import type { WidgetContent } from '../widget-types';
import { RecruitingWizard } from '@/components/recruiting-wizard';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';
import { ResponsesSpreadsheet } from './recruiting/responses-spreadsheet';

// 카드 본문 = RecruitingWizard (3-step: 조건 → 설문 → Google Form 발행).
// 이전엔 위젯 바닥에 발행된 폼 목록 "최근 산출물" 영역이 있었지만, prod
// 마이그 lag 로 인한 forms/list 500/401 폭주 + UX 정리 차원에서 제거.
// 발행 결과 링크는 wizard 의 Card 3 발행 완료 패널에서 바로 노출.
//
// 전체보기 (fullview) = 발행된 설문의 **응답 spreadsheet** 만 노출
// (사용자 명시 2026-07-01: "리크루팅은 설문 참여 제출한 스프레드시트
// 결과물 만 보여지면 되"). 새 설문을 만드는 wizard 는 카드 본문에만 두고,
// fullview 는 응답 데이터에 집중한다. wizard 는 카드 안에 항상 마운트되어
// 있으므로 fullview 가 열려도 진행 state 가 끊기지 않는다.
function ExpandedBody() {
  const { renderInSlot, close } = useFullview('recruiting');
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5">
          <RecruitingWizard />
        </div>
      </div>
      {renderInSlot(
        <WidgetFullviewPanel
          title="리크루팅 — 응답"
          subtitle="발행된 설문의 응답 spreadsheet"
          onClose={close}
        >
          <ResponsesSpreadsheet />
        </WidgetFullviewPanel>,
      )}
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
