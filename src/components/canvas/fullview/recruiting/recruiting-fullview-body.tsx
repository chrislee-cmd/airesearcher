'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingFullviewBody — 풀뷰 V2 Recruiting 본문 (CD state 08 · Responses).
   design-handoff/FULLVIEW-SHELL.md §F4 Recruiting · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 recruiting-card 의 WidgetFullviewPanel 인라인 렌더 ·
   conditions-panel · distribution-panel · judged-list-table · responses-
   spreadsheet 프레젠테이션은 supersede — 편집·재사용 금지). 로직/데이터
   (host state · buildDistributionTable · judgments fetch · CSV export)만 재사용.

   저니 셸(RecruitingJourneyShell)의 탭① 본문으로 re-home 됨 — 헤더 액션
   (프로젝트 pill · CSV · refresh · 마스터링크 · Share · 3탭 내비)은 저니
   셸이 소유해 FullviewHeaderSlot 로 publish 한다(데드포털 fix: 옛
   renderInHeaderStart/End 는 셸이 포털 타깃을 세팅 안 해 렌더 안 됐음 —
   CONTEXTRECRUITINGFULLVIEW A1). 이 본문은 응답 분석만 렌더한다.
   본문 = 좌 400px (criteria + distribution) + 우 flex-1 (폼 셀렉터 + 요약/
   raw 탭 + fit 판단 테이블). raw 탭 = 데이터 SSOT(ResponsesSpreadsheet) 를
   그대로 마운트해 좌측 패널에 응답을 공급 + "전체 데이터" 뷰로 노출.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { Banner } from '../../shell/banner';
import { Button } from '@/components/ui/button';
import { FullviewStatusChip } from '../fullview-header';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import {
  selectorLabel,
  ResponseTable,
  type FormSummary,
} from '../../widgets/recruiting/responses-spreadsheet';
import type {
  FilterableQuestion,
  RecruitingFilter,
} from '@/lib/recruiting/distribution';
import type { ResponseJudgment } from '@/lib/recruiting/persona-fit';
import { RecruitingCriteriaPanel } from './recruiting-criteria-panel';
import { RecruitingDistribution } from './recruiting-distribution';
import { RecruitingJudgedTable } from './recruiting-judged-table';
import { RecruitingBridge, type BridgeCandidate } from './recruiting-bridge';

export function RecruitingFullviewBody({
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
  onDownloadCsv,
  hasResponses,
  intakeBand,
  intakeData,
  rawTabContent,
  bridgeSelected,
  onToggleRow,
  onToggleAll,
  onJudgmentsChange,
  bridgeCandidates,
  bridgeFormId,
  bridgeProjectId,
  onClearSelection,
  onBridgeSent,
}: {
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
  // CSV 내보내기 — 응답 전용 액션. 셸 헤더에서 이 토글 밴드 우측으로 이관됨
  // (round-2 feedback #7). hasResponses=false 면 disabled.
  onDownloadCsv: () => void;
  hasResponses: boolean;
  // 명단 소스 스트립(#587) — 유입 컴팩트 스트립. 좌패널 최상단 카드로 배치
  // (579 툴바 아래 밴드에서 이관, 순서 LIST SOURCES → 참여자 조건 → 분포).
  // upload · Google Sheets 2 소스만(응답연동 행은 CD 컴팩트 설계로 제거).
  intakeBand: ReactNode;
  // 업로드 명단(intake) 세그먼트 데이터(card 588) — CSV/시트 유입분(stage=intake)
  // 을 스프레드시트 shape 으로 어댑트한 것. null 이면 유입분 0(폼 응답 전용 = 현행).
  // 폼 응답과 업로드 명단이 둘 다 있으면 소스 세그먼트로 토글, 업로드만 있으면
  // (폼 없이 유입 — 583) 업로드 명단이 기본 노출된다.
  intakeData: { columns: FormColumn[]; rows: FormResponseRow[] } | null;
  // 데이터 SSOT + "전체 데이터" 탭 = 레거시 ResponsesSpreadsheet(마운트 유지).
  rawTabContent: ReactNode;
  // ── 브리지(N1·N4) — 요약/raw 두 뷰가 공유하는 선택 집합. 호스트가 SSOT.
  bridgeSelected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  onJudgmentsChange: (judgments: ResponseJudgment[]) => void;
  // 선택 응답자 서술자(호스트가 judgments+selected 로 빌드) — 브리지 모달용.
  bridgeCandidates: BridgeCandidate[];
  bridgeFormId: string | null;
  bridgeProjectId: string | null;
  onClearSelection: () => void;
  onBridgeSent: () => void;
}) {
  const t = useTranslations('Recruiting.fv');
  // 좌측 패널 가로 collapse — 로컬 state, 기본 펼침 (탭③ 캘린더 레일과 동일 패턴).
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // ── 소스 세그먼트(card 588) — 폼 응답 vs 업로드 명단. 폼 스키마와 업로드
  // 명단 컬럼이 달라 한 표로 합치지 않고 소스를 토글한다.
  const [sourceSel, setSourceSel] = useState<'forms' | 'upload'>('forms');
  const formCount = responseData?.rows.length ?? 0;
  const intakeCount = intakeData?.rows.length ?? 0;
  const hasFormSource = forms.length > 0;
  const hasUploadSource = intakeCount > 0;
  const showSegment = hasFormSource && hasUploadSource;
  // effective source: 업로드만 있으면 업로드, 폼만 있으면 폼, 둘 다면 사용자 선택.
  // 상태 리셋 이펙트 없이 파생만으로 스테일 선택을 방어(선택 소스가 사라지면 폴백).
  const activeSource: 'forms' | 'upload' =
    !hasFormSource && hasUploadSource
      ? 'upload'
      : !hasUploadSource
        ? 'forms'
        : sourceSel;
  // 업로드 명단은 사용자 소유 plaintext → PII 컬럼 숨김 없음(빈 Set).
  const emptyPii = useMemo(() => new Set<string>(), []);
  const uploadIds = useMemo(
    () => intakeData?.rows.map((r) => r.responseId) ?? [],
    [intakeData],
  );

  return (
    // min-w-0 = 폭 봉쇄 체인(568). 본문 루트가 판단테이블/스프레드시트의
    // intrinsic 폭으로 팽창하지 않도록 flex 자식 min-width:auto(min-content)를
    // 0 으로 눌러, 우측 컬럼이 가시 폭에 고정되고 브리지 CTA 가 클립 밖으로
    // 밀려나지 않게 한다. 가로 스크롤은 테이블 wrapper 한 겹에만 남는다.
    // w-full flex-1 = 셸의 responses wrapper(flex row)에서 본문이 가용 폭을
    // *항상 fill*(R3 계약). 없으면 flex 자식 기본 flex-grow:0 이라, 컬럼 적은
    // 폼 + 좌패널 접힘처럼 콘텐츠가 좁을 때 본문이 content 폭으로 수축해 우측에
    // dead space 가 남았다(#571 재현). 폭은 100%로 clip 되므로 프레임 팽창 0.
    <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col bg-surface-canvas">
      {criteriaPersistMissing && (
        <Banner tone="warning" divider="none">
          {t('criteriaMissingBanner')}
          <Button
            variant="link"
            size="sm"
            className="ml-1 px-0"
            onClick={onCriteriaRepublish}
          >
            {t('criteriaRepublish')}
          </Button>
        </Banner>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {/* 좌측 = 명단 소스(최상단) + 참여자 조건 + 분포 통계. border-r-2 ink.
            가로 collapse 가능 (탭③ 캘린더 레일 패턴) — 접히면 우측 콘텐츠 전폭.
            명단 소스(#587) = 유입 컴팩트 스트립 — 좌패널 최상단 카드로 이관
            (579 툴바 아래 밴드에서 이동, 순서 LIST SOURCES → 참여자 조건 → 분포). */}
        {!panelCollapsed && (
          <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r-2 border-ink p-4">
            {intakeBand}
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
        )}

        {/* Fold rail — 세로 핸들(‹/›). 접힘 시 세로 mono 라벨 노출. */}
        {/* eslint-disable-next-line react/forbid-elements -- full-height vertical fold handle; Button primitive chrome unsuitable for a rail toggle (§7.11). 탭③ 캘린더 레일과 동일 선례. */}
        <button
          type="button"
          onClick={() => setPanelCollapsed((v) => !v)}
          aria-label={panelCollapsed ? t('panelExpand') : t('panelFold')}
          className="flex w-9 shrink-0 flex-col items-center justify-center gap-3 border-r-2 border-ink bg-paper-soft transition-colors hover:bg-paper"
        >
          <span className="text-lg font-bold text-ink" aria-hidden>
            {panelCollapsed ? '›' : '‹'}
          </span>
          {panelCollapsed && (
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-mute-soft [writing-mode:vertical-rl]">
              {t('panelExpand')}
            </span>
          )}
        </button>

        {/* 우측 = 폼 셀렉터 + 탭(요약 default / 전체 데이터). min-w-0 = flex 자식
            intrinsic 폭 팽창 차단(가로 스크롤 복원 + 토글 헤더 off-screen 방지). */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 소스 세그먼트(card 588) — 폼 응답 / 업로드 명단 토글. 둘 다 있을
              때만 노출(하나뿐이면 그 소스가 곧 본문). */}
          {showSegment && (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-ink/10 bg-paper px-5 py-2">
              {(
                [
                  { key: 'forms', label: `${t('sourceForm')} (${formCount})` },
                  { key: 'upload', label: `${t('sourceUpload')} (${intakeCount})` },
                ] as const
              ).map((src) => {
                const active = activeSource === src.key;
                return (
                  // eslint-disable-next-line react/forbid-elements -- 소스 세그먼트 pill 은 요약/raw 탭 pill 과 동일한 bg-ink·white·radius-pill 전용 chrome (§7.11). 동일 선례.
                  <button
                    key={src.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSourceSel(src.key)}
                    className={`rounded-pill px-3.5 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-ink font-bold text-white'
                        : 'font-semibold text-mute-soft hover:text-ink'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* 업로드 명단 소스 헤더 — 뷰 토글 없음(전체 데이터만). */}
          {activeSource === 'upload' && (
            <div className="flex shrink-0 items-center gap-[10px] border-b border-ink/10 bg-paper px-5 py-[11px]">
              <span className="text-sm font-bold text-ink">
                {t('uploadListTitle')} ({intakeCount})
              </span>
            </div>
          )}

          {activeSource === 'forms' && (
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
                      aria-label={t('formSelect')}
                    >
                      {(() => {
                        const active = forms.find(
                          (f) => f.formId === activeFormId,
                        );
                        return active ? selectorLabel(active) : t('formSelect');
                      })()}
                    </ControlTrigger>
                  )}
                />
              </div>
            ) : (
              <FullviewStatusChip label={t('noFormChip')} tone="rec" />
            )}
            <div
              role="tablist"
              aria-label={t('tablistLabel')}
              className="flex shrink-0 items-center gap-1.5"
            >
              {(
                [
                  { key: 'summary', label: t('tabSummary') },
                  { key: 'raw', label: t('tabRaw') },
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
            {/* CSV(응답 내보내기) — 토글 밴드 우측 정렬(round-2 feedback #7:
                셸 헤더에서 이관). 셸 헤더 CSV 와 동일 pill chrome 재사용. */}
            {/* eslint-disable-next-line react/forbid-elements -- CSV pill 은 radius-pill·border-ink·memphis-sm 전용 chrome 으로 Button primitive 의 radius/variant 와 불일치(§7.11). 이전 셸 헤더 CSV 조각과 동일 선례. */}
            <button
              type="button"
              onClick={onDownloadCsv}
              disabled={!hasResponses}
              title={t('csvTitle')}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1.5 text-sm font-bold text-ink shadow-memphis-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              ↓ CSV
            </button>
          </div>
          )}

          <div className="relative min-h-0 min-w-0 flex-1">
            {/* raw = 데이터 SSOT(항상 마운트 — className 만 토글해 위치 고정,
                소스/탭 전환에도 ResponsesSpreadsheet 이 remount·refetch 되지
                않게 한다). 폼 응답 소스의 "전체 데이터" 탭일 때만 보인다. */}
            <div
              className={
                activeSource === 'forms' && activeTab === 'raw'
                  ? 'h-full min-w-0'
                  : 'hidden'
              }
            >
              {rawTabContent}
            </div>
            {activeSource === 'forms' && activeTab === 'summary' && (
              <div className="h-full min-w-0">
                <RecruitingJudgedTable
                  formId={activeFormId}
                  responseData={responseData}
                  refreshSignal={judgeRefreshSignal}
                  selected={bridgeSelected}
                  onToggleRow={onToggleRow}
                  onToggleAll={onToggleAll}
                  onJudgmentsChange={onJudgmentsChange}
                />
              </div>
            )}
            {/* 업로드 명단 — ResponseTable 재사용(응답 시각 컬럼 없음, PII 숨김
                없음). 선택은 폼 응답과 동일한 브리지 집합을 공유(cand: 접두어로
                키 공간 분리). 승격은 하단 공용 브리지 바가 소유(§S5). */}
            {activeSource === 'upload' && intakeData && (
              <div className="h-full min-w-0 overflow-auto bg-paper">
                <ResponseTable
                  columns={intakeData.columns}
                  piiQids={emptyPii}
                  rows={intakeData.rows}
                  selected={bridgeSelected}
                  onToggleRow={onToggleRow}
                  onToggleAll={(checked) => onToggleAll(uploadIds, checked)}
                  showTime={false}
                />
              </div>
            )}
          </div>

          {/* 브리지 바 + N4 모달 — 선택 시 우측 패널 하단 밴드로 노출. 요약/raw
              두 뷰가 같은 선택 집합을 공유하므로 탭 무관 상시 배치(이중 CTA 금지,
              구 스프레드시트 CTA 는 통합·제거). 선택 0 이면 바 미렌더. */}
          <RecruitingBridge
            selectedCount={bridgeSelected.size}
            candidates={bridgeCandidates}
            formId={bridgeFormId}
            projectId={bridgeProjectId}
            onClear={onClearSelection}
            onSent={onBridgeSent}
          />
        </div>
      </div>
    </div>
  );
}
