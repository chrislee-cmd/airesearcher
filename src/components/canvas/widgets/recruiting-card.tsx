'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { RecruitingWizard } from '@/components/recruiting-wizard';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import {
  ResponsesSpreadsheet,
  type FormSummary,
} from './recruiting/responses-spreadsheet';
import { RecruitingConditionsPanel } from './recruiting/conditions-panel';
import { RecruitingDistributionPanel } from './recruiting/distribution-panel';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';

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
  const { renderInSlot, openFullview, close } = useFullview('recruiting');
  const tWidgets = useTranslations('Widgets');
  // Published state emitted by the wizard. When true, the card shows the
  // shared completion footer ("신청서 제작이 완료되었습니다") whose click
  // opens the responses fullview modal — mirroring 전사록/데스크/인터뷰.
  const [isPublished, setIsPublished] = useState(false);
  // 대상자 조건은 이제 발행 시 recruiting_forms 에 폼별로 저장된다
  // (migration 20260703060414). 우선순위:
  //   1) fullview 에서 *선택된 폼* 의 저장된 조건 (옛 폼·refresh 후에도 노출)
  //   2) 없으면(옛 폼 or 마이그 미적용) wizard 의 실시간 state 로 fallback
  // → 두 경로 모두 실패할 때만 panel 이 EmptyState 를 띄운다.
  const [conditionsBrief, setConditionsBrief] = useState<EditableBrief | null>(
    null,
  );
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);

  const storedBrief: EditableBrief | null =
    selectedForm?.criteria && selectedForm.criteria.length > 0
      ? {
          summary: selectedForm.summary ?? '',
          criteria: selectedForm.criteria,
          schedule: [],
        }
      : null;
  const conditionsForPanel = storedBrief ?? conditionsBrief;

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'recruiting' });
  }, []);

  // 통일 "전체 보기"(응답 spreadsheet) 진입 계측.
  const handleRecruitingFullview = () => {
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'fullview_open',
    });
    trackEvent('widget_viewed', { widget: 'recruiting', fullview: true });
    openFullview();
  };
  return (
    <div className="flex h-full flex-col">
      {/* 통일 서브헤더(대상자 조건 입력 + 조건 검토) + 스크롤 카드 본문은
          wizard 가 자체 관리 — subheader 가 스크롤에 딸려 올라가지 않도록
          wizard 를 flex 컨텍스트의 직접 자식으로 둔다. */}
      <RecruitingWizard
        onPublishedChange={setIsPublished}
        onConditionsChange={setConditionsBrief}
      />
      {isPublished && (
        <WidgetStatusFooter
          status="done"
          label={tWidgets('recruitingDone')}
          viewAllLabel={tWidgets('viewAll')}
          resetKey="recruiting-published"
          onClick={handleRecruitingFullview}
        />
      )}
      {renderInSlot(
        <WidgetFullviewPanel
          title="리크루팅 — 응답"
          subtitle="참여자 조건 · 분포 · 응답 spreadsheet"
          onClose={close}
        >
          {/* 상단 = 2 위젯 (좌 조건 요약 + 우 분포 slot), 하단 = 응답
              spreadsheet. 상단 row 는 고정 높이, 하단 spreadsheet 가 남은
              공간을 flex-1 로 채우며 자체 스크롤(기존 unlock/scroll 유지). */}
          <div className="flex h-full min-h-0 flex-col">
            <div className="grid h-[232px] shrink-0 grid-cols-2 gap-4 border-b-[2px] border-line-soft p-4">
              <RecruitingConditionsPanel brief={conditionsForPanel} />
              <RecruitingDistributionPanel />
            </div>
            <div className="min-h-0 flex-1">
              <ResponsesSpreadsheet onSelectedFormChange={setSelectedForm} />
            </div>
          </div>
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
