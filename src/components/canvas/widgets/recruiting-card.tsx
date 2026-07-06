'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { RecruitingWizard } from '@/components/recruiting-wizard';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import { Banner } from '../shell/banner';
import {
  ResponsesSpreadsheet,
  selectorLabel,
  type FormSummary,
} from './recruiting/responses-spreadsheet';
import { JudgedListTable } from './recruiting/judged-list-table';
import { RecruitingConditionsPanel } from './recruiting/conditions-panel';
import { RecruitingDistributionPanel } from './recruiting/distribution-panel';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import { triggerBlobDownload } from '@/lib/export/download';
import { csvFilename, responsesToCsv } from '@/lib/recruiting/responses-csv';
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

  // 우측 패널 탭 — 'summary'(부합도 판단 요약 리스트, default) / 'raw'(옛 응답
  // 스프레드시트, 보조 탭). 요약이 default 이므로 fullview 첫 화면 = 판단 리스트.
  const [activeTab, setActiveTab] = useState<'summary' | 'raw'>('summary');
  // 폼 선택을 host 가 SSOT 로 쥔다 — 공유 셀렉터 하나가 요약/raw 탭 + 좌측
  // 조건·분포 패널을 한 폼으로 묶는다. ResponsesSpreadsheet 은 이 값을
  // controlled prop 으로 받아 응답을 로드하고, 목록/선택 폼을 다시 lift 한다.
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  // 상단 통합 새로고침 시 요약 탭의 판단도 재조회하도록 신호를 증가시킨다.
  const [judgeRefreshSignal, setJudgeRefreshSignal] = useState(0);

  const handleFormsChange = useCallback((list: FormSummary[]) => {
    setForms(list);
    setActiveFormId((prev) => prev ?? list[0]?.formId ?? null);
  }, []);

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
    // 요약 탭의 부합도 판단도 재조회(신규 응답 증분 판단).
    setJudgeRefreshSignal((n) => n + 1);
    // spec C: 새로고침 = 초기 상태 → crossFilter(분포 셀/질문 필터) 초기화.
    setActiveFilter(EMPTY_FILTER);
  }, []);

  // 전체보기 상단 "CSV 다운로드" — 선택된 폼의 응답 전체를 내보낸다.
  // PII 컬럼(이름/전화)은 responses-csv 가 컬럼째 제외하므로 파일에 개인정보가
  // 남지 않는다. host 가 이미 lift 한 responseData(전체 응답, 필터 무관)를 쓰므로
  // "전체" 응답이 그대로 나간다 — 화면 crossfilter 와 독립.
  const hasResponses = (responseData?.rows.length ?? 0) > 0;
  const handleDownloadCsv = useCallback(() => {
    if (!responseData || responseData.rows.length === 0) return;
    trackEvent('widget_action', {
      widget: 'recruiting',
      action: 'fullview_csv_download',
    });
    const csv = responsesToCsv(responseData.columns, responseData.rows);
    const title = forms.find((f) => f.formId === activeFormId)?.title ?? null;
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      csvFilename(title, stamp),
    );
  }, [responseData, forms, activeFormId]);

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
  return (
    <div className="flex h-full flex-col">
      {/* wizard = 컨트롤 (조건 → 설문 → 발행). 서브헤더 slim bar 폐기 —
          phase 무관 항상 노출되어 발행 후에도 재발행/조건 조정이 가능하다.
          fullview·진행 state 보존을 위해 항상 마운트. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <RecruitingWizard
          onPublishedChange={setIsPublished}
          onConditionsChange={setConditionsBrief}
        />
      </div>

      {/* 산출물 영역 — 발행 완료 시만. 하단 통일 완료 푸터로 "이미 발행됨 →
          전체보기(응답 spreadsheet)" 신호 (전사록/데스크/인터뷰와 동일). */}
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
          headerAction={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={!hasResponses}
                title="응답 전체를 CSV 로 내려받습니다 (이름·전화 등 개인정보 제외)"
              >
                CSV 다운로드
              </Button>
              <Button variant="secondary" size="sm" onClick={handleRefresh}>
                새로고침
              </Button>
            </div>
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

              {/* 우측 패널 = 공유 폼 셀렉터 + 탭(요약 default / 전체 데이터).
                  ResponsesSpreadsheet 은 raw 탭이 아닐 때도 항상 마운트해 둔다 —
                  좌측 조건/분포 패널이 이 컴포넌트가 lift 하는 선택 폼·응답에
                  의존하므로(요약 탭이 default 여도 좌측이 살아 있어야 함). 요약
                  탭일 땐 CSS 로만 숨긴다(unmount X). */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2">
                  {forms.length > 0 ? (
                    // 컨트롤 드롭다운 통일 — native <Select> → DropdownMenu
                    // (인터뷰 기준). 항목/value/onChange 로직 불변 (spec 결정 3).
                    <div className="min-w-[240px]">
                      <DropdownMenu
                        items={forms.map((f) => ({
                          key: f.formId,
                          label: selectorLabel(f),
                          onSelect: () => setActiveFormId(f.formId),
                        }))}
                        trigger={({ open, onClick, ...aria }) => (
                          <ControlTrigger
                            {...aria}
                            data-open={open}
                            onClick={onClick}
                            aria-label="설문 선택"
                          >
                            {(() => {
                              const active = forms.find(
                                (f) => f.formId === activeFormId,
                              );
                              return active
                                ? selectorLabel(active)
                                : '설문 선택';
                            })()}
                          </ControlTrigger>
                        )}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-mute-soft">
                      발행된 설문 없음
                    </span>
                  )}
                  <div
                    role="tablist"
                    aria-label="응답 보기 방식"
                    className="ml-auto flex items-center gap-1"
                  >
                    <Button
                      variant={activeTab === 'summary' ? 'primary' : 'ghost'}
                      size="xs"
                      role="tab"
                      aria-selected={activeTab === 'summary'}
                      onClick={() => setActiveTab('summary')}
                    >
                      부합도 요약
                    </Button>
                    <Button
                      variant={activeTab === 'raw' ? 'primary' : 'ghost'}
                      size="xs"
                      role="tab"
                      aria-selected={activeTab === 'raw'}
                      onClick={() => setActiveTab('raw')}
                    >
                      전체 데이터
                    </Button>
                  </div>
                </div>

                <div className="relative min-h-0 flex-1">
                  {/* raw 스프레드시트 — 좌측 패널 데이터 공급 위해 항상 마운트,
                      요약 탭일 땐 display:none 으로만 숨김. */}
                  <div className={activeTab === 'raw' ? 'h-full' : 'hidden'}>
                    <ResponsesSpreadsheet
                      selectedFormId={activeFormId}
                      onSelectFormId={setActiveFormId}
                      onFormsChange={handleFormsChange}
                      hideSelector
                      onSelectedFormChange={setSelectedForm}
                      onFormsLoadingChange={setFormsLoading}
                      onRegisterRefresh={registerResponsesRefresh}
                      filter={activeFilter}
                      onFilterableQuestionsChange={setFilterableQuestions}
                      onResponsesChange={setResponseData}
                      onResponsesLoadingChange={setResponsesLoading}
                    />
                  </div>
                  {activeTab === 'summary' && (
                    <div className="h-full">
                      <JudgedListTable
                        formId={activeFormId}
                        responseData={responseData}
                        refreshSignal={judgeRefreshSignal}
                      />
                    </div>
                  )}
                </div>
              </div>
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
