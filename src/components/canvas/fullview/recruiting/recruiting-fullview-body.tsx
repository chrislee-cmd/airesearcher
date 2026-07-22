'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingFullviewBody — 풀뷰 V2 Recruiting 본문 (CD state 08 · Responses).
   design-handoff/FULLVIEW-SHELL.md §F4 Recruiting · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 recruiting-card 의 WidgetFullviewPanel 인라인 렌더 ·
   conditions-panel · distribution-panel · judged-list-table · responses-
   spreadsheet 프레젠테이션은 supersede — 편집·재사용 금지). 로직/데이터
   (host state · buildDistributionTable · judgments fetch · CSV export)만 재사용.

   공유 FullviewShell 의 본문 slot 에 portal 되며, 헤더 액션(프로젝트 pill ·
   CSV · 새로고침)은 §F3 header slot(renderInHeaderStart/End)으로 주입한다.
   본문 = 좌 400px (criteria + distribution) + 우 flex-1 (폼 셀렉터 + 요약/
   raw 탭 + fit 판단 테이블). raw 탭 = 데이터 SSOT(ResponsesSpreadsheet) 를
   그대로 마운트해 좌측 패널에 응답을 공급 + "전체 데이터" 뷰로 노출.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { Banner } from '../../shell/banner';
import { Button } from '@/components/ui/button';
import {
  FullviewProjectPill,
  FullviewStatusChip,
} from '../fullview-header';
import { useFullview } from '../../shell/fullview-shell-context';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import {
  selectorLabel,
  type FormSummary,
} from '../../widgets/recruiting/responses-spreadsheet';
import type {
  FilterableQuestion,
  RecruitingFilter,
} from '@/lib/recruiting/distribution';
import { RecruitingCriteriaPanel } from './recruiting-criteria-panel';
import { RecruitingDistribution } from './recruiting-distribution';
import { RecruitingJudgedTable } from './recruiting-judged-table';

export function RecruitingFullviewBody({
  projectName,
  conditionsForPanel,
  criteriaPersistMissing,
  onCriteriaRepublish,
  responseData,
  responsesLoading,
  formsLoading,
  hasForm,
  filterableQuestions,
  activeFilter,
  onFilterChange,
  forms,
  activeFormId,
  onSelectFormId,
  activeTab,
  onTabChange,
  judgeRefreshSignal,
  hasResponses,
  onDownloadCsv,
  onRefresh,
  rawTabContent,
}: {
  projectName: string | null;
  conditionsForPanel: EditableBrief | null;
  criteriaPersistMissing: boolean;
  onCriteriaRepublish: () => void;
  responseData: { columns: FormColumn[]; rows: FormResponseRow[] } | null;
  responsesLoading: boolean;
  formsLoading: boolean;
  hasForm: boolean;
  filterableQuestions: FilterableQuestion[];
  activeFilter: RecruitingFilter;
  onFilterChange: (filter: RecruitingFilter) => void;
  forms: FormSummary[];
  activeFormId: string | null;
  onSelectFormId: (id: string) => void;
  activeTab: 'summary' | 'raw';
  onTabChange: (tab: 'summary' | 'raw') => void;
  judgeRefreshSignal: number;
  hasResponses: boolean;
  onDownloadCsv: () => void;
  onRefresh: () => void;
  // 데이터 SSOT + "전체 데이터" 탭 = 레거시 ResponsesSpreadsheet(마운트 유지).
  rawTabContent: ReactNode;
}) {
  const { renderInHeaderStart, renderInHeaderEnd } = useFullview('recruiting');

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      {/* §F3 헤더 slot 주입 — 좌: 프로젝트 pill / 우: CSV · 새로고침 */}
      {projectName &&
        renderInHeaderStart(<FullviewProjectPill name={projectName} />)}
      {renderInHeaderEnd(
        <div className="flex items-center gap-2.5">
          {/* CD state 08 헤더 액션 — pill chrome(radius-pill·memphis-sm). Button
              primitive 의 radius/variant 와 불일치(§7.11)라 sanctioned native. */}
          {/* eslint-disable-next-line react/forbid-elements -- CD §F3 CSV 는 radius-pill·border-ink·memphis-sm 전용 chrome 으로 Button primitive 와 불일치. */}
          <button
            type="button"
            onClick={onDownloadCsv}
            disabled={!hasResponses}
            title="응답 전체를 CSV 로 내려받습니다 (이름·전화 등 개인정보 제외)"
            className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-memphis-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            ↓ CSV
          </button>
          {/* eslint-disable-next-line react/forbid-elements -- CD §F3 Refresh 는 radius-pill·border-ink/16·무그림자 mute 전용 chrome 으로 Button primitive 와 불일치. */}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-ink/16 bg-paper px-3 py-1.5 text-sm font-semibold text-mute-soft hover:text-ink"
          >
            ↻ 새로고침
          </button>
        </div>,
      )}

      {criteriaPersistMissing && (
        <Banner tone="warning" divider="none">
          이 설문에는 저장된 참여자 조건이 없습니다.
          <Button
            variant="link"
            size="sm"
            className="ml-1 px-0"
            onClick={onCriteriaRepublish}
          >
            조건 다시 발행하기
          </Button>
        </Banner>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 좌측 = 참여자 조건(위) + 분포 통계(아래). border-r-2 ink. */}
        <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r-2 border-ink p-4">
          <RecruitingCriteriaPanel brief={conditionsForPanel} />
          <RecruitingDistribution
            columns={responseData?.columns ?? []}
            rows={responseData?.rows ?? []}
            loading={responsesLoading}
            formsLoading={formsLoading}
            hasForm={hasForm}
            filterableQuestions={filterableQuestions}
            filter={activeFilter}
            onFilterChange={onFilterChange}
          />
        </div>

        {/* 우측 = 폼 셀렉터 + 탭(요약 default / 전체 데이터). */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-[10px] border-b border-ink/10 bg-paper px-5 py-[11px]">
            {forms.length > 0 ? (
              <div className="min-w-[240px]">
                <DropdownMenu
                  items={forms.map((f) => ({
                    key: f.formId,
                    label: selectorLabel(f),
                    onSelect: () => onSelectFormId(f.formId),
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
              <FullviewStatusChip label="발행된 설문 없음" tone="rec" />
            )}
            <div
              role="tablist"
              aria-label="응답 보기 방식"
              className="ml-auto flex items-center gap-1.5"
            >
              {(
                [
                  { key: 'summary', label: '부합도 요약' },
                  { key: 'raw', label: '전체 데이터' },
                ] as const
              ).map((tab) => {
                const active = activeTab === tab.key;
                return (
                  // eslint-disable-next-line react/forbid-elements -- CD state 08 탭 pill 은 bg-ink·white·radius-pill 전용 chrome 으로 Button primitive 의 radius/variant 와 불일치(§7.11). 헤더 조각과 동일 선례.
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onTabChange(tab.key)}
                    className={`rounded-pill px-3.5 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-ink font-bold text-white'
                        : 'font-semibold text-mute-soft hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {/* raw = 데이터 SSOT(항상 마운트). 요약 탭일 땐 display:none. */}
            <div className={activeTab === 'raw' ? 'h-full' : 'hidden'}>
              {rawTabContent}
            </div>
            {activeTab === 'summary' && (
              <div className="h-full">
                <RecruitingJudgedTable
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
  );
}
