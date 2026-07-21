'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { track as mixpanelTrack } from '@/components/mixpanel-provider';
import { useRequireAuth } from '@/components/auth-provider';
import { useGenerationJobs } from '@/components/generation-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import { Button } from '@/components/ui/button';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import { ControlBoardPanel } from '../shell/control-board-panel';
import { WidgetPrimaryCta } from '../shell/widget-primary-cta';
import { useWidgetState } from '../shell/widget-state-context';
import {
  RecruitingSetupAccordion,
  type RecruitingGoogleStatus,
  type RecruitingPublishedForm,
} from './recruiting/setup-accordion';
import { applyStandardBlocks } from '@/lib/recruiting/survey-postprocess';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey } from '@/lib/survey-schema';
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
import {
  clearDraft,
  loadDraft,
  persistDraft,
  settleStreamingPhase,
  type EditableBrief,
  type Phase,
} from '@/components/recruiting-wizard/draft-storage';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import { triggerBlobDownload } from '@/lib/export/download';
import { csvFilename, responsesToCsv } from '@/lib/recruiting/responses-csv';
import {
  EMPTY_FILTER,
  type FilterableQuestion,
  type RecruitingFilter,
} from '@/lib/recruiting/distribution';

// 카드 본문 = RecruitingSetupFlow (V3: 소스 → 조건 → 설문 → Google Form
// 발행을 공유 셸 + 4-스텝 아코디언으로). 이전엔 위젯 바닥에 발행된 폼 목록
// "최근 산출물" 영역이 있었지만, prod 마이그 lag 로 인한 forms/list 500/401
// 폭주 + UX 정리 차원에서 제거. 발행 결과 링크는 발행 스텝 완료 패널에서 바로 노출.
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
      {/* 세팅 = 공유 셸(ControlBoardPanel) + 4-스텝 아코디언 (probing/전사록
          미러). 소스 → 조건 → 설문 → 발행. phase 무관 항상 노출되어 발행
          후에도 재발행/조건 조정이 가능하다. fullview·진행 state 보존을 위해
          항상 마운트. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <RecruitingSetupFlow
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

// ── 세팅 플로우 (로직 홀더) ─────────────────────────────────────────────
// V3: 옛 RecruitingWizard(3-카드 + 서브헤더)를 대체. extract·survey 생성·
// Google 발행 로직/상태/API 는 그대로 재사용하되(회귀 0), 표현만 공유 셸
// (ControlBoardPanel) + 4-스텝 아코디언(RecruitingSetupAccordion, probing/
// 전사록 미러)으로 올린다. 발행 CTA 는 셸 WidgetPrimaryCta 로 하단 고정.
//
// 로직은 recruiting-wizard/wizard.tsx 에서 포팅 — API 엔드포인트(/api/
// recruiting/extract · /survey · /google/*)·standard-blocks·draft 영속은 불변.

type Criterion = RecruitingBrief['criteria'][number];

const RECRUITING_ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;
const RECRUITING_MAX_FILES = 10;

// 발행 체인 진행 라벨 인덱스 → i18n 키. 실제 per-stage 신호가 없어 타임드
// UX 큐 (wizard PUBLISH_STAGES 미러). afterMs 는 아래 effect 가 소유.
const PUBLISH_STAGE_AFTER_MS = [0, 1200, 4500, 8000];

// Google refresh token 만료/취소 → 재-OAuth 만이 복구. 서버가 문자열로
// 표면화하는 패턴을 substring 매칭.
function isReauthError(msg: string | null): boolean {
  if (!msg) return false;
  return /token_refresh_failed|invalid_grant|unauthorized|google_not_connected/i.test(
    msg,
  );
}

async function reconnectGoogle() {
  try {
    await fetch('/api/recruiting/google/disconnect', { method: 'POST' });
  } catch {
    // best-effort — /google/start 가 어차피 토큰 row 를 덮어씀.
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/api/recruiting/google/start';
  }
}

// LLM 스트림이 잘린/빈 버퍼로 끝나면 strict parse 가 터진다. strict → 부분
// 파서 순으로 시도하고, 필요한 배열이 있을 때만 수용. truncatedMsg 는 호출부가
// i18n 으로 넘긴다 (모듈 함수라 hook 접근 불가).
async function coerceBrief(
  buffer: string,
  truncatedMsg: string,
): Promise<RecruitingBrief> {
  if (!buffer.trim()) throw new Error(truncatedMsg);
  try {
    return JSON.parse(buffer) as RecruitingBrief;
  } catch {
    // fall through to partial parse
  }
  const parsed = await parsePartialJson(buffer);
  const obj =
    parsed.value && typeof parsed.value === 'object'
      ? (parsed.value as Record<string, unknown>)
      : null;
  if (obj && Array.isArray(obj.criteria) && Array.isArray(obj.schedule)) {
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      criteria: obj.criteria as RecruitingBrief['criteria'],
      schedule: obj.schedule as RecruitingBrief['schedule'],
    };
  }
  throw new Error(truncatedMsg);
}

async function coerceSurvey(
  buffer: string,
  truncatedMsg: string,
): Promise<Survey> {
  if (!buffer.trim()) throw new Error(truncatedMsg);
  try {
    return JSON.parse(buffer) as Survey;
  } catch {
    // fall through
  }
  const parsed = await parsePartialJson(buffer);
  const obj =
    parsed.value && typeof parsed.value === 'object'
      ? (parsed.value as Record<string, unknown>)
      : null;
  if (obj && Array.isArray(obj.sections)) {
    return {
      title: typeof obj.title === 'string' ? obj.title : '',
      description: typeof obj.description === 'string' ? obj.description : '',
      sections: obj.sections as Survey['sections'],
    };
  }
  throw new Error(truncatedMsg);
}

function RecruitingSetupFlow({
  onPublishedChange,
  onConditionsChange,
}: {
  onPublishedChange?: (published: boolean) => void;
  onConditionsChange?: (brief: EditableBrief | null) => void;
}) {
  const t = useTranslations('Recruiting.setup');
  const requireAuth = useRequireAuth();
  const jobs = useGenerationJobs();
  const workspace = useWorkspace();
  const gate = useWidgetGate('recruiting');
  const { setState: setWidgetState } = useWidgetState();

  // Draft rehydration — 한 번만 읽고 아래 effect 에서 clear.
  const [hydrationDraft] = useState(() => loadDraft());

  // ── 조건 ──────────────────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState(() => hydrationDraft?.pasted ?? '');
  const [rejected, setRejected] = useState<string[]>([]);
  const [criteriaPhase, setCriteriaPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.criteriaPhase) : 'idle',
  );
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  const [partialBrief, setPartialBrief] = useState<
    Partial<RecruitingBrief> | null
  >(() => hydrationDraft?.partialBrief ?? null);
  const [editedBrief, setEditedBrief] = useState<EditableBrief | null>(
    () => hydrationDraft?.editedBrief ?? null,
  );

  // ── 설문 ──────────────────────────────────────────────────────────
  const [surveyPhase, setSurveyPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.surveyPhase) : 'idle',
  );
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(
    () => hydrationDraft?.survey ?? null,
  );

  // ── Google Form ───────────────────────────────────────────────────
  const [google, setGoogle] = useState<RecruitingGoogleStatus | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (!g || g === 'connected') return null;
    return g;
  });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<RecruitingPublishedForm | null>(
    null,
  );
  const [publishStageIdx, setPublishStageIdx] = useState(0);

  useEffect(() => {
    onPublishedChange?.(!!published);
  }, [published, onPublishedChange]);
  useEffect(() => {
    onConditionsChange?.(editedBrief);
  }, [editedBrief, onConditionsChange]);

  // Google 연결 상태.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/recruiting/google/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setGoogle({
            connected: !!j.connected,
            email: j.email ?? null,
            hasDrive: !!j.hasDrive,
            adminProxy: !!j.adminProxy,
          });
        }
      })
      .catch(() => {});
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('google')) {
        params.delete('google');
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : '');
        window.history.replaceState(null, '', next);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // 시드 후 draft 제거 (idempotent — strict-mode 이중 마운트 무해).
  useEffect(() => {
    if (hydrationDraft) clearDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function captureDraft() {
    persistDraft({
      pasted,
      partialBrief,
      editedBrief,
      survey,
      criteriaPhase,
      surveyPhase,
    });
  }

  // 추출 done → editable brief 시드 (source result 아이덴티티로 재시드 방지).
  const job = jobs.get('recruiting');
  const jobRunning = job.status === 'running';
  const jobResult =
    job.status === 'done' ? (job.result as RecruitingBrief | null) : null;
  const [seededFor, setSeededFor] = useState<RecruitingBrief | null>(null);
  if (jobResult && jobResult !== seededFor) {
    setSeededFor(jobResult);
    setEditedBrief({
      summary: jobResult.summary ?? '',
      criteria: jobResult.criteria.map((c) => ({ ...c })),
      schedule: jobResult.schedule.map((p) => ({ ...p })),
    });
    setCriteriaPhase('review');
  }

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of Array.from(incoming)) {
      if (RECRUITING_ACCEPT_RE.test(f.name)) accepted.push(f);
      else rejectedNames.push(f.name);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => `${p.name}::${p.size}`));
      const next = [...prev];
      for (const f of accepted) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key) && next.length < RECRUITING_MAX_FILES) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
    setRejected(rejectedNames);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function startExtract() {
    requireAuth(() => void doExtract());
  }

  async function doExtract() {
    if (files.length === 0 && !pasted.trim()) return;
    const admitted = await gate.acquire();
    if (!admitted) return;
    mixpanelTrack('recruiting_extract_click', {
      feature: 'recruiting',
      file_count: files.length,
      pasted_chars: pasted.length,
    });
    const submittedFiles = files;
    const submittedPaste = pasted;

    setCriteriaError(null);
    setPartialBrief(null);
    setEditedBrief(null);
    setSeededFor(null);
    setSurveyPhase('idle');
    setSurvey(null);
    setSurveyError(null);
    setPublished(null);
    setPublishError(null);
    setCriteriaPhase('generating');

    const truncatedMsg = t('streamTruncated');
    try {
      await jobs.start<RecruitingBrief>('recruiting', {
        input: { count: submittedFiles.length },
        run: async () => {
          const fd = new FormData();
          for (const f of submittedFiles) fd.append('files', f);
          if (submittedPaste.trim()) fd.append('pasted', submittedPaste);

          const res = await fetch('/api/recruiting/extract', {
            method: 'POST',
            body: fd,
          });
          if (!res.ok || !res.body) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error ?? `extract_failed: ${res.statusText}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = await parsePartialJson(buffer);
            if (parsed.value && typeof parsed.value === 'object') {
              setPartialBrief(parsed.value as Partial<RecruitingBrief>);
            }
          }

          const finalParsed = await coerceBrief(buffer, truncatedMsg);
          setPartialBrief(finalParsed);
          mixpanelTrack('recruiting_extract_success', { feature: 'recruiting' });
          return finalParsed;
        },
      });
    } finally {
      gate.release();
    }
  }

  // job-level error 흡수 (seededFor 패턴).
  const currentJobError =
    job.status === 'error' ? (job.error ?? 'extract_failed') : null;
  const [absorbedJobError, setAbsorbedJobError] = useState<string | null>(null);
  if (currentJobError !== absorbedJobError) {
    setAbsorbedJobError(currentJobError);
    if (currentJobError) {
      setCriteriaPhase('idle');
      setCriteriaError(currentJobError);
    }
  }

  function approveCriteria() {
    if (!editedBrief) return;
    setCriteriaPhase('approved');
    void doGenerateSurvey(editedBrief);
  }

  function restartCriteria() {
    setCriteriaPhase('idle');
    setPartialBrief(null);
    setEditedBrief(null);
    setSeededFor(null);
    setCriteriaError(null);
    setSurveyPhase('idle');
    setSurvey(null);
    setSurveyError(null);
    setPublished(null);
    setPublishError(null);
  }

  const surveyAbortRef = useRef<AbortController | null>(null);

  async function doGenerateSurvey(brief: EditableBrief) {
    surveyAbortRef.current?.abort();
    const ctrl = new AbortController();
    surveyAbortRef.current = ctrl;

    setSurveyPhase('generating');
    setSurveyError(null);
    setSurvey(null);
    setPublished(null);
    setPublishError(null);
    mixpanelTrack('recruiting_survey_generate_click', {
      feature: 'recruiting_survey',
    });
    trackEvent('job_started', {
      widget: 'recruiting',
      job_type: 'form_generate',
    });
    const generateStartedAt = Date.now();
    const truncatedMsg = t('streamTruncated');

    try {
      const briefForApi: RecruitingBrief = {
        summary: brief.summary,
        criteria: brief.criteria,
        schedule: brief.schedule,
      };
      const res = await fetch('/api/recruiting/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: briefForApi }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `survey_failed: ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      if (ctrl.signal.aborted) return;
      const rawSurvey = await coerceSurvey(buffer, truncatedMsg);
      // 표준 블록(인적사항 + 전화번호 + 개인정보 동의)은 post-LLM 주입 —
      // 사용자가 승인 전에 *완전한* 설문을 보게. publish route 가 동일
      // idempotent post-process 를 재적용 (defense in depth).
      const finalSurvey = applyStandardBlocks(rawSurvey);
      setSurvey(finalSurvey);
      setSurveyPhase('review');
      mixpanelTrack('recruiting_survey_generate_success', {
        feature: 'recruiting_survey',
      });
      trackEvent('job_completed', {
        widget: 'recruiting',
        job_type: 'form_generate',
        duration_ms: Math.max(0, Date.now() - generateStartedAt),
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      trackEvent('job_failed', {
        widget: 'recruiting',
        job_type: 'form_generate',
        error: e instanceof Error ? e.message : 'survey_failed',
      });
      setSurveyError(e instanceof Error ? e.message : 'survey_failed');
      setSurveyPhase('idle');
    } finally {
      if (surveyAbortRef.current === ctrl) surveyAbortRef.current = null;
    }
  }

  function approveSurvey() {
    if (!survey) return;
    setSurveyPhase('approved');
    // 발행 체인은 아래 effect 가 (surveyPhase==='approved' && google.connected
    // && !published) 조건에서 한 번 fire — OAuth 왕복 재개 경로도 커버. 여기선
    // 이전 에러만 클리어; 미연결이면 먼저 OAuth 로 보낸다.
    setPublishError(null);
    if (google && !google.connected && !google.adminProxy) {
      captureDraft();
      if (typeof window !== 'undefined') {
        window.location.href = '/api/recruiting/google/start';
      }
    }
  }

  function regenerateSurvey() {
    if (!editedBrief) return;
    void doGenerateSurvey(editedBrief);
  }

  async function autoPublish() {
    if (!survey) return;
    setPublishing(true);
    setPublishStageIdx(0);
    setPublishError(null);
    try {
      const res = await fetch('/api/recruiting/google/forms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          survey,
          criteria: editedBrief?.criteria,
          summary: editedBrief?.summary,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error ?? `publish_failed: ${res.statusText}`);
      }
      const pub: RecruitingPublishedForm = {
        formId: j.formId ?? j.form_id,
        responderUri: j.responderUri,
        sheetUrl: j.sheetUrl ?? null,
      };
      setPublished(pub);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('recruiting:published'));
      }
      mixpanelTrack('recruiting_publish_success', {
        feature: 'recruiting_publish',
      });
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'recruiting_form_published',
        metadata: { form_id: pub.formId },
      });
      if (pub.formId) {
        const md = [
          `# ${survey.title || 'Recruiting form'}`,
          '',
          `- ${t('responderLabel')}: ${pub.responderUri ?? ''}`,
          '',
          ...survey.sections.flatMap((s) => [
            `## ${s.title || ''}`,
            ...s.questions.map((q, i) => `${i + 1}. ${q.title}`),
            '',
          ]),
        ].join('\n');
        let activeProjectId: string | null = null;
        try {
          const raw = window.localStorage.getItem('active_project:v1');
          if (raw) {
            const parsed = JSON.parse(raw) as { id?: string } | null;
            activeProjectId = parsed?.id ?? null;
          }
        } catch {}
        workspace.addArtifact({
          id: `recruiting_${pub.formId}`,
          featureKey: 'recruiting',
          title: `${survey.title || 'recruiting'}.md`,
          content: md,
          dbFeature: 'recruiting',
          dbId: pub.formId,
          projectId: activeProjectId,
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        setPublishError(t('publishTimeout'));
      } else {
        setPublishError(e instanceof Error ? e.message : 'publish_failed');
      }
    } finally {
      setPublishing(false);
    }
  }

  // 자동 발행 트리거 — 승인 + Google 연결 + 미발행 시 1회. OAuth 왕복 재개도 커버.
  const triggeredForRef = useRef<Survey | null>(null);
  useEffect(() => {
    if (surveyPhase !== 'approved') return;
    if (!survey) return;
    if (published || publishing) return;
    if (publishError) return;
    if (!google) return;
    if (!google.connected) return;
    if (triggeredForRef.current === survey) return;
    triggeredForRef.current = survey;
    void autoPublish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyPhase, survey, published, publishing, publishError, google]);

  // 발행 진행 라벨 스테이지 타이머.
  useEffect(() => {
    if (!publishing) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    PUBLISH_STAGE_AFTER_MS.forEach((afterMs, idx) => {
      if (idx === 0) return;
      timers.push(setTimeout(() => setPublishStageIdx(idx), afterMs));
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [publishing]);

  // 헤더 state pill sync — phase 진행을 헤더로 broadcast (라벨 없이 running).
  useEffect(() => {
    if (publishError || criteriaError || surveyError) {
      const message = publishError ?? criteriaError ?? surveyError ?? undefined;
      setWidgetState({ kind: 'error', message });
      return;
    }
    if (publishing || surveyPhase === 'generating' || criteriaPhase === 'generating') {
      setWidgetState({ kind: 'running' });
      return;
    }
    if (published) {
      setWidgetState({ kind: 'done' });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [
    setWidgetState,
    publishing,
    surveyPhase,
    criteriaPhase,
    publishError,
    criteriaError,
    surveyError,
    published,
  ]);

  // ── Derived ────────────────────────────────────────────────────────
  const partialCriteria: Criterion[] = editedBrief
    ? editedBrief.criteria
    : ((partialBrief?.criteria ?? []).filter(
        (c): c is Criterion =>
          typeof c?.category === 'string' &&
          typeof c?.label === 'string' &&
          typeof c?.detail === 'string' &&
          typeof c?.required === 'boolean',
      ) as Criterion[]);
  const canExtract =
    (files.length > 0 || pasted.trim().length > 0) && !jobRunning;
  const surveyReady =
    !!survey && (surveyPhase === 'review' || surveyPhase === 'approved');
  const generating =
    criteriaPhase === 'generating' || surveyPhase === 'generating';

  const publishStageLabel =
    [
      t('publishStage1'),
      t('publishStage2'),
      t('publishStage3'),
      t('publishStage4'),
    ][publishStageIdx] ?? t('publishing');
  const needsReauth = isReauthError(publishError) && !google?.adminProxy;

  // 하단 CTA — phase-adaptive 단일 forward 액션 (spec: "Publish form →").
  // 준비 단계(설문 미완)에선 파이프라인 전진, 설문 준비되면 발행.
  const ctaPublishMode = surveyReady && !published;
  const ctaBusy = publishing || generating;
  const ctaLabel = ctaPublishMode ? t('ctaPublish') : t('ctaPrepare');
  const ctaBusyLabel = ctaPublishMode ? t('ctaPublishing') : t('ctaPreparing');
  const ctaDisabled = ctaPublishMode
    ? false
    : editedBrief
      ? false
      : !canExtract;

  function handleCta() {
    if (ctaPublishMode) {
      requireAuth(() => approveSurvey());
      return;
    }
    if (editedBrief) {
      approveCriteria();
      return;
    }
    startExtract();
  }

  return (
    <div className="flex h-full flex-col">
      <ControlBoardPanel gap="none">
        <ControlBoardPanel.Region>
          <RecruitingSetupAccordion
            files={files}
            pasted={pasted}
            rejected={rejected}
            running={jobRunning}
            onPasteChange={setPasted}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            criteriaPhase={criteriaPhase}
            editedBrief={editedBrief}
            partialCount={partialCriteria.length}
            criteriaError={criteriaError}
            onEditedBriefChange={setEditedBrief}
            onRestart={restartCriteria}
            surveyPhase={surveyPhase}
            survey={survey}
            surveyError={surveyError}
            onSurveyChange={setSurvey}
            onRegenerateSurvey={regenerateSurvey}
            google={google}
            googleAuthError={googleAuthError}
            publishing={publishing}
            publishStageLabel={publishStageLabel}
            published={published}
            publishError={publishError}
            needsReauth={needsReauth}
            onConnect={() => {
              if (typeof window !== 'undefined') {
                captureDraft();
                window.location.href = '/api/recruiting/google/start';
              }
            }}
            onReconnect={() => {
              captureDraft();
              void reconnectGoogle();
            }}
            onRetry={() => requireAuth(() => void autoPublish())}
            onClearAuthError={() => setGoogleAuthError(null)}
          />
        </ControlBoardPanel.Region>
      </ControlBoardPanel>

      {!published && (
        <WidgetPrimaryCta
          label={ctaLabel}
          busyLabel={ctaBusyLabel}
          busy={ctaBusy}
          disabled={ctaDisabled}
          onClick={handleCta}
        />
      )}
    </div>
  );
}

// 리크루팅 canvas widget — 세팅(소스 → 조건 → 설문 → Google Form 발행)을
// 공유 셸 + 4-스텝 아코디언으로 widget body 에 마운트. PREVIEW_FEATURES 에
// 속해 canvas/page.tsx 의 server-side preview gate 가 일반 유저에게 자동 숨김.
export const recruitingCard: WidgetContent = {
  key: 'recruiting',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단). 헤더밴드 타이틀은 labelKey 로.
    label: '리크루팅',
    labelKey: 'Features.recruiting.title',
    accent: 'sun',
    cost: 10,
    thumbnail: '/thumbnail/recruiting.png',
    description:
      '리서치 목적·페르소나·문항 초안을 LLM 으로 한 번에 생성합니다.',
    expandedCols: 3,
    // Canvas 1c 카드 프레임 opt-in — 604×900 카드 + sun 파스텔 헤더밴드 +
    // 통합 툴바(💎10). probing·전사록·통역·UT 와 동일 프레임 상속.
    cardFrame: true,
  },
  state: 'idle',
  ExpandedBody,
};
