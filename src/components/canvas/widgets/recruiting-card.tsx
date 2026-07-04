'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { Button } from '@/components/ui/button';
import { RecruitingWizard } from '@/components/recruiting-wizard';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import { Banner } from '../shell/banner';
import {
  ResponsesSpreadsheet,
  type FormSummary,
} from './recruiting/responses-spreadsheet';
import { RecruitingConditionsPanel } from './recruiting/conditions-panel';
import { RecruitingDistributionPanel } from './recruiting/distribution-panel';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import {
  EMPTY_FILTER,
  type FilterableQuestion,
  type RecruitingFilter,
} from '@/lib/recruiting/distribution';

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
  // Phase 2 slim control bar 접힘/펼침. 발행 후 기본은 접힘(controls 숨김 +
  // 발행 완료 보드 노출). ▼ 클릭으로 wizard 를 다시 펼쳐 재발행/조건 조정.
  // wizard 는 항상 마운트되므로(진행 state 보존) collapse 는 display:none.
  const [controlsExpanded, setControlsExpanded] = useState(false);
  // 대상자 조건은 이제 발행 시 recruiting_forms 에 폼별로 저장된다
  // (migration 20260703060414). 우선순위:
  //   1) fullview 에서 *선택된 폼* 의 저장된 조건 (옛 폼·refresh 후에도 노출)
  //   2) 없으면(옛 폼 or 마이그 미적용) wizard 의 실시간 state 로 fallback
  // → 두 경로 모두 실패할 때만 panel 이 EmptyState 를 띄운다.
  const [conditionsBrief, setConditionsBrief] = useState<EditableBrief | null>(
    null,
  );
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);
  // spreadsheet 의 발행-폼 목록이 아직 로딩 중인지. 분포 위젯이 formId===null
  // 을 "로딩 중" vs "발행 폼 없음" 으로 구분하는 데 쓴다 (초기 flash 방지).
  const [formsLoading, setFormsLoading] = useState(true);
  // Crossfilter SSOT — 분포 패널과 응답 spreadsheet 의 공통 부모라 여기서
  // multi-select 필터를 쥔다. 분포 패널이 셀 다중선택/질문 필터로 set, 분포
  // crosstab 재계산 + spreadsheet row 필터가 모두 이 값을 read.
  const [activeFilter, setActiveFilter] =
    useState<RecruitingFilter>(EMPTY_FILTER);
  // spreadsheet 이 로드한 응답 컬럼에서 파생한 객관식 질문 목록 — 분포 패널의
  // 질문 필터 팝오버가 쓴다.
  const [filterableQuestions, setFilterableQuestions] = useState<
    FilterableQuestion[]
  >([]);
  // spreadsheet 이 로드한 응답(컬럼 + 행)을 여기로 lift → 분포 패널이 필터 적용
  // 후 같은 rows 로 crosstab 을 client-side 재계산 (필터 반영 sync fix).
  const [responseData, setResponseData] = useState<{
    columns: FormColumn[];
    rows: FormResponseRow[];
  } | null>(null);
  const [responsesLoading, setResponsesLoading] = useState(false);

  // 선택 폼이 바뀌면 이전 폼 기준 필터는 무의미 → 초기화(전체 응답 복원).
  // React 권장 "prop 변경 시 state 리셋" 패턴 — effect 대신 render 중 조정해
  // 폼 전환이 한 커밋 안에서 필터 리셋과 함께 반영된다.
  const selectedFormId = selectedForm?.formId ?? null;
  const [prevFormId, setPrevFormId] = useState(selectedFormId);
  if (selectedFormId !== prevFormId) {
    setPrevFormId(selectedFormId);
    setActiveFilter(EMPTY_FILTER);
  }

  // 응답 spreadsheet 의 refetch 함수를 여기로 등록한다. fullview 상단 통합
  // "새로고침" 버튼이 호출 → 응답이 다시 로드되면 lift 된 responseData 가
  // 갱신되고 분포 crosstab 도 자동 재계산된다 (분포는 이제 응답에서 파생 —
  // 별도 refetch 불필요). ref 라 등록이 리렌더를 유발하지 않는다.
  const refreshResponsesRef = useRef<(() => void) | null>(null);
  const registerResponsesRefresh = useCallback((fn: () => void) => {
    refreshResponsesRef.current = fn;
  }, []);
  const handleRefresh = useCallback(() => {
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'fullview_refresh',
    });
    refreshResponsesRef.current?.();
    // spec C: 새로고침 = 초기 상태 → crossFilter(분포 셀/질문 필터) 초기화.
    setActiveFilter(EMPTY_FILTER);
  }, []);

  const storedBrief: EditableBrief | null =
    selectedForm?.criteria && selectedForm.criteria.length > 0
      ? {
          summary: selectedForm.summary ?? '',
          criteria: selectedForm.criteria,
          schedule: [],
        }
      : null;
  const conditionsForPanel = storedBrief ?? conditionsBrief;

  // 선택된 폼에 저장된 참여자 조건이 없을 때 fullview 상단에 경고 배너.
  // 두 원인을 같은 UI 로 커버한다:
  //   ① 옛 폼 (migration 20260703060414 이전 발행 → criteria 컬럼 null)
  //   ② 발행 시 criteria persist 실패 (create/route.ts 가 criteriaPersisted
  //      플래그를 false 로 반환 — 마이그 lag 등) → 저장된 조건이 비어 있음
  // 둘 다 "이 폼엔 조건이 안 남았다" 로 사용자에게 동일하게 보인다. selectedForm
  // 이 null 이면(폼 선택 전 empty state) 배너를 띄우지 않아 두 상태를 구분한다.
  // wizard 는 카드 본문에 항상 마운트돼 있으므로 "재발행" CTA 는 fullview 를
  // 닫아 사용자를 wizard 로 돌려보낸다(별도 wizard-open API 없음 — 보수적 재사용).
  const criteriaPersistMissing =
    selectedForm != null &&
    !(selectedForm.criteria && selectedForm.criteria.length > 0);

  const handleCriteriaRepublish = () => {
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'criteria_republish',
    });
    close();
  };

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
  // 전체보기를 한 번 연 세션에서 lift 된 응답 행 수 = 응답 count. fullview
  // 를 아직 안 열었으면 null (새 fetch 없이 opportunistic — 상단 주석의
  // forms/list 폭주 회피).
  const responseCount = responseData?.rows.length ?? null;

  const handleControlsToggle = () => {
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'controls_toggle',
    });
    setControlsExpanded((v) => !v);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Phase 2 slim 컨트롤 바 — 발행 후 wizard controls 를 접어 두는 얇은
          바. ▼ 클릭 = wizard 재확장(재발행/조건 조정). 발행 전(idle)엔 wizard
          가 곧 컨트롤 보드이므로 바를 띄우지 않는다. */}
      {isPublished && (
        <SlimControlBar
          label={tWidgets('recruitingControlBar')}
          expanded={controlsExpanded}
          onToggle={handleControlsToggle}
        />
      )}

      {/* wizard = idle 컨트롤 보드 + 폼 발행 flow. fullview·진행 state 보존을
          위해 항상 마운트하고, 발행 후 접힘 상태에서만 display:none 으로 숨긴다
          (unmount 시 published/criteria/survey state 유실 → phase 깨짐). */}
      <div
        className={
          'flex min-h-0 flex-1 flex-col' +
          (isPublished && !controlsExpanded ? ' hidden' : '')
        }
      >
        <RecruitingWizard
          onPublishedChange={setIsPublished}
          onConditionsChange={setConditionsBrief}
        />
      </div>

      {/* Phase 2 발행 완료 보드 — controls 접힘 시 메인 영역. 발행 완료 +
          응답 count + 전체보기 진입 CTA. */}
      {isPublished && !controlsExpanded && (
        <PublishedBoard
          responseCount={responseCount}
          onFullview={handleRecruitingFullview}
        />
      )}

      {/* controls 펼침(재편집) 상태에선 하단 통일 완료 푸터로 "이미 발행됨 →
          전체보기" 신호 유지 (전사록/데스크/인터뷰와 동일). 접힘 상태는 위
          발행 완료 보드가 그 역할을 하므로 중복 노출하지 않는다. */}
      {isPublished && controlsExpanded && (
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
          headerAction={
            <Button variant="secondary" size="sm" onClick={handleRefresh}>
              새로고침
            </Button>
          }
        >
          {/* 좌우 2패널 — 좌: 참여자 조건(위) + 분포 통계(아래) 세로,
              우: 응답 spreadsheet 테이블만. (발행 폼 드롭다운·필터 wire 는
              main 아키텍처 그대로 — spreadsheet 이 폼/응답 SSOT, 분포는
              lift 된 responseData 에서 파생.) */}
          <div className="flex h-full min-h-0 flex-col">
            {criteriaPersistMissing && (
              <Banner tone="warning" divider="none">
                {tWidgets('recruitingCriteriaEmptyBanner')}
                <Button
                  variant="link"
                  size="sm"
                  className="ml-1 px-0"
                  onClick={handleCriteriaRepublish}
                >
                  {tWidgets('recruitingCriteriaEmptyBannerCta')}
                </Button>
              </Banner>
            )}
            <div className="flex min-h-0 flex-1">
              {/* 좌측 패널 = 참여자 조건(위) + 분포 통계(아래) 세로 스택.
                  조건은 고정 높이, 분포는 내용 크기에 맞춘 auto height(빈 공간 X).
                  둘 합이 패널보다 커지면 좌측 컬럼이 세로 스크롤. */}
              <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line-soft p-4">
                <div className="h-[240px] shrink-0">
                  <RecruitingConditionsPanel brief={conditionsForPanel} />
                </div>
                {/* 분포 위젯 = 내용 크기에 맞춤(auto height, 패널 자체 min 만 유지).
                    옛 flex-1 은 짧은 테이블에서도 좌측 컬럼 남은 공간을 다 채워
                    white space 가 생겼다 — shrink-0 으로 테이블 크기에 fit. */}
                <div className="shrink-0">
                  <RecruitingDistributionPanel
                    columns={responseData?.columns ?? []}
                    rows={responseData?.rows ?? []}
                    loading={responsesLoading}
                    formsLoading={formsLoading}
                    hasForm={selectedForm != null}
                    filterableQuestions={filterableQuestions}
                    filter={activeFilter}
                    onFilterChange={setActiveFilter}
                  />
                </div>
              </div>

              {/* 우측 패널 = 응답 spreadsheet 만 (남은 가로 공간 전부). */}
              <div className="min-h-0 flex-1 p-4">
                <ResponsesSpreadsheet
                  onSelectedFormChange={setSelectedForm}
                  onFormsLoadingChange={setFormsLoading}
                  onRegisterRefresh={registerResponsesRefresh}
                  filter={activeFilter}
                  onFilterableQuestionsChange={setFilterableQuestions}
                  onResponsesChange={setResponseData}
                  onResponsesLoadingChange={setResponsesLoading}
                />
              </div>
            </div>
          </div>
        </WidgetFullviewPanel>,
      )}
    </div>
  );
}

// Phase 2 얇은 컨트롤 바 — 발행 후 wizard controls 를 접어 두고, ⚙ 라벨 +
// ▼(rotate) 로 펼침 여부를 표시. 전면-폭 composite 클릭 바라 native button +
// data-canvas-action opt-out (WidgetStatusFooter 선례).
function SlimControlBar({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    /* eslint-disable-next-line react/forbid-elements -- 전면-폭 컨트롤 바:
       ⚙ 라벨 + ▼ 복합 레이아웃이라 Button primitive variant 에 매핑 안 됨.
       data-canvas-action 으로 canvas [data-canvas-body] cascade opt-out. */
    <button
      type="button"
      onClick={onToggle}
      data-canvas-action
      aria-expanded={expanded}
      className="flex shrink-0 items-center gap-2 border-b-[2px] border-ink bg-paper-soft px-5 py-2.5 text-left text-sm font-semibold text-ink transition-colors hover:bg-paper"
    >
      <span aria-hidden className="shrink-0">
        ⚙
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden
        className={
          'shrink-0 text-mute transition-transform' +
          (expanded ? ' rotate-180' : '')
        }
      >
        ▼
      </span>
    </button>
  );
}

// Phase 2 발행 완료 보드 — controls 접힘 시 메인 영역. 완료 배지 + 응답 count
// (전체보기를 한 번 연 세션에서만 확보 — 새 fetch 없이 lift 된 응답에서 파생)
// + 전체보기 CTA.
function PublishedBoard({
  responseCount,
  onFullview,
}: {
  responseCount: number | null;
  onFullview: () => void;
}) {
  const tWidgets = useTranslations('Widgets');
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-5 py-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xs border-[2px] border-ink bg-mint">
          <RecruitingCheckIcon className="h-4 w-4 text-ink" />
        </span>
        <p className="text-lg font-semibold text-ink">
          {tWidgets('recruitingPublished')}
        </p>
        <p className="text-sm text-mute">
          {responseCount != null
            ? tWidgets('recruitingResponseCount', { count: responseCount })
            : tWidgets('recruitingResponseHint')}
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onFullview}>
        {tWidgets('viewAll')}
      </Button>
    </div>
  );
}

// 완료 ✓ glyph (명시 size className + aria-hidden 으로 a11y 통과).
function RecruitingCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
