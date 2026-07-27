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

import { useCallback, useMemo, useState, type ReactNode } from 'react';
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
import {
  UploadedListControls,
  UPLOAD_EMPTY_VALUE,
  type UploadFilterState,
} from './uploaded-list-controls';
import { uploadedListToCsv } from '@/lib/scheduling/intake-rows';
import { triggerBlobDownload } from '@/lib/export/download';

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

  // 업로드 직후(또는 응답 탭 진입 시 intake 행이 이미 있을 때) "업로드 명단"
  // 소스를 즉시 전면에 띄운다 (사용자 요청 2026-07-27: "업로드하면 응답 탭에서
  // 바로 업로드 명단이 뜨게"). intake 행이 0→N 으로 늘어나는 순간을 감지해
  // sourceSel 을 upload 로 스냅한다. 렌더 중 state 조정 = React 권장 "prop 변경
  // 시 state 리셋" 패턴(recruiting-card prevFormId 선례) — effect 없이 한 커밋
  // 안에서 반영된다. 사용자가 이후 "폼 응답"을 누르면 그 선택은 다음 업로드
  // 전까지 유지된다(재스냅은 카운트가 다시 증가할 때만).
  const [prevIntakeCount, setPrevIntakeCount] = useState(0);
  if (intakeCount !== prevIntakeCount) {
    setPrevIntakeCount(intakeCount);
    if (intakeCount > prevIntakeCount) setSourceSel('upload');
  }

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

  // ── 업로드 명단 정렬·필터(card 597, CD frame N6 리디자인) — 594 의 정렬·필터
  // 파생 로직은 재사용하되 필터 모델을 멀티밸류로 확장(CD 하드룰 §1: 필드 간 AND ·
  // 필드 내 OR). state 는 body 로컬이라 폼/업로드 세그먼트 전환에도 유지된다(spec §D).
  const [uploadSortKey, setUploadSortKey] = useState('');
  const [uploadSortDir, setUploadSortDir] = useState<'asc' | 'desc'>('asc');
  // 멀티밸류 필터: field(questionId) → 선택 값[]. 빈 필드 = 미필터.
  const [uploadFilters, setUploadFilters] = useState<UploadFilterState>({});
  // 검색(이름·연락처 즉시 필터, CD State A). 필터와 별개 축.
  const [uploadSearch, setUploadSearch] = useState('');

  const intakeCols = useMemo(() => intakeData?.columns ?? [], [intakeData]);

  // 정렬 옵션 = 전 컬럼(594 동적 파생 그대로 — CD Name/Contact/… 는 예시일 뿐).
  const uploadSortOptions = useMemo(
    () => intakeCols.map((c) => ({ key: c.questionId, label: c.title })),
    [intakeCols],
  );

  // 필터 질문 = 설문 문항(f:* 필드)만. 연락 컬럼(__name/__email/__phone)은 값이
  // 거의 유일해 필터로 무의미 → CD 좌 pane 이 문항만 나열하는 것과 일치(CD-grounded,
  // 594 는 전 컬럼 허용했으나 CD 를 SSOT 로 채택. PR 본문 명시).
  const uploadQuestions = useMemo(
    () =>
      intakeCols
        .filter((c) => c.questionId.startsWith('f:'))
        .map((c) => ({ id: c.questionId, label: c.title })),
    [intakeCols],
  );

  // 질문별 답변 옵션(값 + 값별 카운트) — 로드된 전체 rows 에서 클라 계산(CD §값별
  // 카운트, 447행 OK). `(빈 값)` 은 1급 옵션(CD 하드룰 §4). 카운트는 전체 기준
  // (필터와 독립) — CD 예시(M1 214 …)가 필터 합보다 큰 총량인 것과 일치.
  const uploadAnswersFor = useCallback(
    (qid: string) => {
      const rows = intakeData?.rows ?? [];
      const counts = new Map<string, number>();
      let emptyCount = 0;
      for (const r of rows) {
        const v = r.answers[qid];
        if (v == null || v.trim() === '') emptyCount += 1;
        else counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const opts = Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: value, count }));
      if (emptyCount > 0) {
        opts.push({
          value: UPLOAD_EMPTY_VALUE,
          label: t('uploadFilterEmpty'),
          count: emptyCount,
        });
      }
      return opts;
    },
    [intakeData, t],
  );

  // 필터 매칭 — 필드 간 AND, 필드 내 OR. 빈 값 sentinel 은 부재/빈문자에 대응.
  const rowMatchesFilters = useCallback(
    (row: FormResponseRow, filters: UploadFilterState) => {
      for (const [qid, vals] of Object.entries(filters)) {
        if (!vals.length) continue;
        const raw = row.answers[qid] ?? '';
        const isEmpty = raw.trim() === '';
        const ok = vals.some((v) =>
          v === UPLOAD_EMPTY_VALUE ? isEmpty : v === raw,
        );
        if (!ok) return false;
      }
      return true;
    },
    [],
  );

  // draft 필터의 행수 미리보기(픽커 푸터 "N rows") — 검색과 독립.
  const uploadMatchCount = useCallback(
    (filters: UploadFilterState) =>
      (intakeData?.rows ?? []).filter((r) => rowMatchesFilters(r, filters))
        .length,
    [intakeData, rowMatchesFilters],
  );

  // 표시 rows = 필터(멀티밸류) → 검색 → 정렬(파생만; columns·선택집합 불변, spec §C).
  const displayIntakeData = useMemo(() => {
    if (!intakeData) return null;
    let rows = intakeData.rows.filter((r) =>
      rowMatchesFilters(r, uploadFilters),
    );
    const q = uploadSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        ['__name', '__phone', '__email'].some((k) =>
          (r.answers[k] ?? '').toLowerCase().includes(q),
        ),
      );
    }
    if (uploadSortKey) {
      const num = (v: string) => {
        const n = Number(v.replace(/[\s,]/g, ''));
        return v.trim() !== '' && Number.isFinite(n) ? n : null;
      };
      rows = [...rows].sort((a, b) => {
        const av = a.answers[uploadSortKey] ?? '';
        const bv = b.answers[uploadSortKey] ?? '';
        const an = num(av);
        const bn = num(bv);
        // 양쪽 다 숫자로 파싱되면 숫자 비교(전화/나이 등), 아니면 localeCompare.
        const cmp =
          an !== null && bn !== null ? an - bn : av.localeCompare(bv);
        return uploadSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return { columns: intakeData.columns, rows };
  }, [
    intakeData,
    uploadFilters,
    uploadSearch,
    uploadSortKey,
    uploadSortDir,
    rowMatchesFilters,
  ]);

  // 전체선택 범위 = 현재 필터·검색·정렬로 "보이는" rows 의 id 만(spec §C 전체선택 주의).
  const uploadIds = useMemo(
    () => displayIntakeData?.rows.map((r) => r.responseId) ?? [],
    [displayIntakeData],
  );

  // CSV = 현재 정렬·필터·검색 적용된 rows(= 화면과 일치, spec §6). 업로드 명단은
  // 사용자 소유 plaintext 라 전 컬럼 포함(응답 CSV 의 PII 제외와 다름).
  const handleDownloadIntakeCsv = useCallback(() => {
    if (!displayIntakeData || displayIntakeData.rows.length === 0) return;
    const csv = uploadedListToCsv(
      displayIntakeData.columns,
      displayIntakeData.rows,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${t('uploadListTitle')}-${stamp}.csv`,
    );
  }, [displayIntakeData, t]);

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

          {/* 업로드 명단 컨트롤 — CD frame N6 리디자인(card 597). segmented Sort/
              Filter 바 + 2-pane 멀티셀렉트 필터(Apply) + 액티브 칩 + 검색 + CSV.
              프레젠테이션은 fresh, 정렬·필터 파생·선택 보존 로직은 여기(body) 소유. */}
          {activeSource === 'upload' && intakeData && intakeData.columns.length > 0 && (
            <UploadedListControls
              totalCount={intakeCount}
              filteredCount={displayIntakeData?.rows.length ?? intakeCount}
              isFiltered={
                (displayIntakeData?.rows.length ?? intakeCount) < intakeCount
              }
              sortOptions={uploadSortOptions}
              sortKey={uploadSortKey}
              sortDir={uploadSortDir}
              onSortKeyChange={setUploadSortKey}
              onSortDirChange={setUploadSortDir}
              sortNoneLabel={t('uploadSortNone')}
              questions={uploadQuestions}
              answersFor={uploadAnswersFor}
              matchCount={uploadMatchCount}
              applied={uploadFilters}
              onApply={setUploadFilters}
              onClearAll={() => setUploadFilters({})}
              search={uploadSearch}
              onSearchChange={setUploadSearch}
              onDownloadCsv={handleDownloadIntakeCsv}
              csvDisabled={(displayIntakeData?.rows.length ?? 0) === 0}
            />
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
            {activeSource === 'upload' && displayIntakeData && (
              <div className="h-full min-w-0 overflow-auto bg-paper">
                <ResponseTable
                  columns={displayIntakeData.columns}
                  piiQids={emptyPii}
                  rows={displayIntakeData.rows}
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
