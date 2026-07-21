'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';
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

// 리크루팅 발행 설문의 **응답 전체보기** — 참여자 조건 · 분포 · 응답
// spreadsheet · 부합도 판단. V3 세팅 카드(fresh)는 셸+4스텝을 신규 빌드하지만,
// 이 응답 machinery 는 로직/데이터 재사용 대상이라 동작 불변으로 보존한다
// (§C fresh-build: 프레젠테이션만 fresh, 로직/데이터 재사용). 짝 PR2 가 이
// 전체보기를 SSOT 대로 재빌드 예정 — 그 전까지 기존 응답 UX 를 그대로 유지.
//
// 가시 렌더 없음 — useFullview('recruiting') 로 모달 슬롯에만 등록. 세팅 카드
// 툴바의 expand(⤢) → openFullview → 이 슬롯이 열린다.
export function RecruitingResponsesFullview({
  // 세팅 훅의 실시간 조건(editedBrief) — 저장된 폼 조건이 없을 때 fallback.
  liveBrief = null,
}: {
  liveBrief?: EditableBrief | null;
}) {
  const { renderInSlot, close } = useFullview('recruiting');
  const tWidgets = useTranslations('Widgets');

  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);
  const [formsLoading, setFormsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<RecruitingFilter>(EMPTY_FILTER);
  const [filterableQuestions, setFilterableQuestions] = useState<
    FilterableQuestion[]
  >([]);
  const [responseData, setResponseData] = useState<{
    columns: FormColumn[];
    rows: FormResponseRow[];
  } | null>(null);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'raw'>('summary');
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [judgeRefreshSignal, setJudgeRefreshSignal] = useState(0);

  const handleFormsChange = useCallback((list: FormSummary[]) => {
    setForms(list);
    setActiveFormId((prev) => prev ?? list[0]?.formId ?? null);
  }, []);

  // 선택 폼이 바뀌면 이전 폼 기준 필터 리셋 (render 중 조정 패턴).
  const selectedFormId = selectedForm?.formId ?? null;
  const [prevFormId, setPrevFormId] = useState(selectedFormId);
  if (selectedFormId !== prevFormId) {
    setPrevFormId(selectedFormId);
    setActiveFilter(EMPTY_FILTER);
  }

  const refreshResponsesRef = useRef<(() => void) | null>(null);
  const registerResponsesRefresh = useCallback((fn: () => void) => {
    refreshResponsesRef.current = fn;
  }, []);
  const handleRefresh = useCallback(() => {
    trackEvent('widget_action', { widget: 'recruiting', action: 'fullview_refresh' });
    refreshResponsesRef.current?.();
    setJudgeRefreshSignal((n) => n + 1);
    setActiveFilter(EMPTY_FILTER);
  }, []);

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

  // 우선순위: 선택 폼에 저장된 조건 > 세팅 훅 실시간 조건(liveBrief).
  const storedBrief: EditableBrief | null =
    selectedForm?.criteria && selectedForm.criteria.length > 0
      ? {
          summary: selectedForm.summary ?? '',
          criteria: selectedForm.criteria,
          schedule: [],
        }
      : null;
  const conditionsForPanel = storedBrief ?? liveBrief;

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

  return renderInSlot(
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
          <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line-soft p-4">
            <div className="h-[240px] shrink-0">
              <RecruitingConditionsPanel brief={conditionsForPanel} />
            </div>
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

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2">
              {forms.length > 0 ? (
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
                          return active ? selectorLabel(active) : '설문 선택';
                        })()}
                      </ControlTrigger>
                    )}
                  />
                </div>
              ) : (
                <span className="text-sm text-mute-soft">발행된 설문 없음</span>
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
  );
}

// 리크루팅 canvas widget meta (SSOT). 가시 카드는 canvas-board 가 recruiting
// 키에서 <RecruitingSetupCard> (V3 fresh 셸+4스텝) 로 분기 렌더 — ExpandedBody
// 는 그 경로에서 안 쓰인다(안전 폴백 null). meta 는 label/accent/cost/thumbnail
// 을 nav·navigator 가 공유. labelKey 로 헤더 타이틀 i18n (ko 리크루팅 / en
// Recruiting) — SSOT 헤더와 일치.
export const recruitingCard: WidgetContent = {
  key: 'recruiting',
  meta: {
    label: 'Recruiting',
    labelKey: 'Sidebar.recruiting',
    accent: 'sun',
    cost: 10,
    thumbnail: '/thumbnail/recruiting.png',
    description:
      '리서치 목적·페르소나·문항 초안을 LLM 으로 한 번에 생성합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody: () => null,
};
