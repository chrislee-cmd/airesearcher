'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parsePartialJson } from 'ai';
import type { WidgetContent } from '../widget-types';
import { track as trackEvent } from '@/lib/analytics/events';
import { track as mixpanelTrack } from '@/components/mixpanel-provider';
import { useRequireAuth } from '@/components/auth-provider';
import { useGenerationJobs } from '@/components/generation-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import { useProjectSelection } from '@/components/project-selection-provider';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
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
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import {
  ResponsesSpreadsheet,
  type FormSummary,
} from './recruiting/responses-spreadsheet';
import { RecruitingFullviewBody } from '../fullview/recruiting/recruiting-fullview-body';
import { JourneyIntakeBand } from '../fullview/recruiting/journey-intake-band';
import {
  RecruitingJourneyShell,
  type JourneyTab,
} from '../fullview/recruiting/recruiting-journey-shell';
import type { BridgeCandidate } from '../fullview/recruiting/recruiting-bridge';
import type { ResponseJudgment } from '@/lib/recruiting/persona-fit';
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
  // ── 리크루팅 세 축 (다음 워커가 헷갈리지 않도록, spec #575 §6) ──────────
  //   1) pill 축 = interview_projects (SSOT: useInterviewV2Projects). 위젯이
  //      어느 리서치 프로젝트에 귀속되는지 — 선택은 위젯별 독립
  //      (useProjectSelection('recruiting'), translate/probing 미러).
  //   2) 데이터 축 = recruiting_forms.interview_project_id (migration
  //      20260726070359). 발행 폼이 어느 pill 프로젝트에 stamp 됐는지 —
  //      forms/create 가 stamp, forms/list 가 `?project_id=` 로 필터. 이게
  //      "새 프로젝트 = 빈 Responses" 를 만든다(#575 의 핵심 수정). ⚠️ 옛
  //      recruiting_forms.project_id(마이그 0014)는 **옛 projects 테이블** 참조라
  //      pill 과 무관 — deprecated, 쓰지 말 것.
  //   3) sched 축 = form-anchor (formId → resolveOrCreateProjectForForm →
  //      sched_projects). 그 폼의 응답·명단·일정이 어느 sched row 에 저장되는지
  //      (탭②·③ 내부 데이터). pill 과 **별개 축** — 이번에도 미접촉(573 계약).
  // 축 1↔2 만 연결한다(pill ↔ 데이터). 1↔3, 2↔3 은 엮지 않는다.
  //
  // 예전엔 useActiveProject(워크스페이스 단일 활성 프로젝트)를 써서 다른 위젯
  // 피커와 단위가 어긋났다(round-2 feedback #3).
  const { getSelection, setSelection } = useProjectSelection();
  const recruitingProjectId = getSelection('recruiting');
  const {
    projects: interviewProjects,
    create,
    archive,
    unarchive,
  } = useInterviewV2Projects();
  const projects = useMemo(
    () => interviewProjects.map((p) => ({ id: p.id, name: p.name })),
    [interviewProjects],
  );
  const activeProject = useMemo(
    () => projects.find((p) => p.id === recruitingProjectId) ?? null,
    [projects, recruitingProjectId],
  );
  const handleSelectProject = useCallback(
    (projectId: string | null) => setSelection('recruiting', projectId),
    [setSelection],
  );
  // pill 생성 배선 — 훅 create({project|null}) 를 pill 계약({id}|null)으로 어댑트.
  // 보관/취소는 훅 archive/unarchive 를 그대로 넘긴다. ⚠️ 이 축은 interview_projects
  // 만 — 탭②·③ 의 sched form-anchor 프로젝트는 별개 축(위 pill 주석 계약 유지).
  const handleCreateProject = useCallback(
    async (nm: string) => {
      const { project } = await create(nm);
      return project ? { id: project.id } : null;
    },
    [create],
  );
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

  // ── 브리지(N1·N4) 선택 SSOT — 요약(판단테이블)·raw(스프레드시트) 두 뷰가
  // 하나의 선택 집합(responseId)을 공유한다. 폼 전환 시 리셋(다른 폼 응답을
  // 잘못 브리지하지 않도록). judgments 는 요약 탭에서 lift — 모달 서술자용.
  const [bridgeSelected, setBridgeSelected] = useState<Set<string>>(new Set());
  const [judgments, setJudgments] = useState<ResponseJudgment[]>([]);

  const toggleBridgeRow = useCallback((id: string) => {
    setBridgeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleBridgeAll = useCallback((ids: string[], checked: boolean) => {
    setBridgeSelected((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);
  const clearBridge = useCallback(() => setBridgeSelected(new Set()), []);

  // ── 저니 탭(응답/일정) SSOT — 셸을 controlled 로 구동. 저니 2탭화(#579)로
  // 명단 탭이 제거돼, 브리지 전송 성공 시엔 선택만 리셋한다(브리지 컴포넌트가
  // 자체 성공 토스트를 띄운다). 인제스트된 인원은 탭③(일정)이 조건부 마운트라
  // 다음 진입 시 fresh fetch 로 노출된다 — 탭 이동 강제 없음(spec §1 유입 규칙을
  // 브리지에도 동일 적용; 보수적 해석, PR 본문 명시).
  const [journeyTab, setJourneyTab] = useState<JourneyTab>('responses');
  const handleBridgeSent = useCallback(() => {
    clearBridge();
  }, [clearBridge]);

  // 선택 응답자 서술자 — judgments 에서 selected 를 필터해 #번호·demographic·fit
  // 를 빌드(응답 name 은 PII 블랭킹으로 클라에 없음 → 마스킹 값만 모달 표시).
  const bridgeCandidates = useMemo<BridgeCandidate[]>(() => {
    const byKey = new Map(
      judgments.map((j, i) => [j.response_key, { j, num: i + 1 }]),
    );
    return Array.from(bridgeSelected).map((id) => {
      const hit = byKey.get(id);
      if (!hit) return { id, num: null, demo: null, fit: null };
      const demo =
        [hit.j.gender, hit.j.age_group, hit.j.region]
          .filter(Boolean)
          .join(' · ') || null;
      return { id, num: hit.num, demo, fit: hit.j.fit };
    });
  }, [bridgeSelected, judgments]);

  const handleFormsChange = useCallback((list: FormSummary[]) => {
    setForms(list);
    // pill 전환 시 목록이 새 프로젝트 기준으로 오면 이전 선택 폼이 목록에 없을
    // 수 있다 — 그땐 첫 폼(없으면 null=빈 상태)으로 스냅해 스테일 선택을 버린다.
    // 같은 목록이면 기존 선택 유지(prev in list).
    setActiveFormId((prev) =>
      prev && list.some((f) => f.formId === prev)
        ? prev
        : (list[0]?.formId ?? null),
    );
  }, []);

  // 선택 폼이 바뀌면 이전 폼 기준 필터는 무의미 → 초기화(전체 응답 복원).
  // React 권장 "prop 변경 시 state 리셋" 패턴 — effect 대신 render 중 조정해
  // 폼 전환이 한 커밋 안에서 필터 리셋과 함께 반영된다.
  const selectedFormId = selectedForm?.formId ?? null;
  const [prevFormId, setPrevFormId] = useState(selectedFormId);
  if (selectedFormId !== prevFormId) {
    setPrevFormId(selectedFormId);
    setActiveFilter(EMPTY_FILTER);
    // 폼 전환 = 브리지 선택도 무효(다른 폼 응답을 잘못 브리지하지 않도록).
    setBridgeSelected(new Set());
    setJudgments([]);
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
          interviewProjectId={recruitingProjectId}
          onProjectChange={handleSelectProject}
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
      {/* 풀뷰 V2 (fullviewV2) — CD state 08 fresh 본문. 공유 FullviewShell 이
          프레임/사이드바/헤더 스캐폴드를 소유하고, 이 본문이 slot 으로 portal
          된다(헤더 액션은 §F3 header slot 으로 주입). 데이터 SSOT =
          ResponsesSpreadsheet(rawTabContent 으로 마운트 유지 → 좌측 패널 공급
          + "전체 데이터" 탭). 상태/로직은 위 host 가 그대로 소유. */}
      {renderInSlot(
        <RecruitingJourneyShell
          projectName={activeProject?.name ?? null}
          projects={projects}
          activeProjectId={activeProject?.id ?? null}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
          onArchiveProject={archive}
          onUnarchiveProject={unarchive}
          // P0(백엔드) 미머지 — 마스터링크 lazy 프로비저닝 · counts API ·
          // 접근통일(Share orgId+members) 은 각 웨이브가 배선. P1 은 셸 구조만
          // 완성하고 이 슬롯들은 graceful 숨김(스펙 §제약).
          masterLink={null}
          counts={undefined}
          shareButton={undefined}
          onRefresh={handleRefresh}
          // 저니 탭 SSOT(controlled) — 브리지 전송 성공 시 host 가 탭②로 전환.
          activeTab={journeyTab}
          onTabChange={setJourneyTab}
          // 탭②(명단)·탭③(일정) form-anchored 데이터 앵커 — host 가 SSOT 로 쥔
          // 활성 폼(탭③ 은 이 form 으로 scheduling 데이터 페치 = P0 project resolve).
          formId={activeFormId}
          responsesTab={
            <RecruitingFullviewBody
              conditionsForPanel={conditionsForPanel}
              criteriaPersistMissing={criteriaPersistMissing}
              onCriteriaRepublish={handleCriteriaRepublish}
              responseData={responseData}
              responsesLoading={responsesLoading}
              formsLoading={formsLoading}
              hasForm={selectedForm != null}
              filterableQuestions={filterableQuestions}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              forms={forms}
              activeFormId={activeFormId}
              onSelectFormId={setActiveFormId}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              judgeRefreshSignal={judgeRefreshSignal}
              // CSV = 응답 내보내기 → 탭①(응답)의 요약/raw 토글 밴드 우측에 둔다
              // (round-2 feedback #7: 셸 헤더에서 이관). 헤더는 전 탭 공용이라
              // CSV(응답 전용)엔 부적합.
              onDownloadCsv={handleDownloadCsv}
              hasResponses={hasResponses}
              // 명단 소스 밴드(#579) — 저니 2탭화로 유입 3종(CSV·시트·응답연동)이
              // 이 응답 탭으로 이관됐다. activeFormId 앵커로 project/inbox 를 자체
              // 페치(옛 candidates 탭 로직 이식). 툴바 아래·프레임 안에 배치.
              intakeBand={<JourneyIntakeBand formId={activeFormId} />}
              // 브리지(N1·N4) — 선택 SSOT + judgments lift + 서술자.
              bridgeSelected={bridgeSelected}
              onToggleRow={toggleBridgeRow}
              onToggleAll={toggleBridgeAll}
              onJudgmentsChange={setJudgments}
              bridgeCandidates={bridgeCandidates}
              bridgeFormId={activeFormId}
              // 초대 인제스트 타깃은 form_id 로 resolve(P0) — invitation 의
              // project_id 는 부수적이라 null(구 CTA 와 동일한 보수적 처리; 캔버스
              // activeProject.id 를 sched project_id 로 오용하지 않는다).
              bridgeProjectId={null}
              onClearSelection={clearBridge}
              // D1-A: 전송 성공 = 즉시 명단 반영 → 선택 리셋 + 탭②(명단) 전환.
              onBridgeSent={handleBridgeSent}
              rawTabContent={
                <ResponsesSpreadsheet
                  selectedFormId={activeFormId}
                  onSelectFormId={setActiveFormId}
                  onFormsChange={handleFormsChange}
                  // pill 축 스코프 — 이 프로젝트에 stamp 된 폼만 로드(빈 상태 보장).
                  projectId={recruitingProjectId}
                  hideSelector
                  onSelectedFormChange={setSelectedForm}
                  onFormsLoadingChange={setFormsLoading}
                  onRegisterRefresh={registerResponsesRefresh}
                  filter={activeFilter}
                  onFilterableQuestionsChange={setFilterableQuestions}
                  onResponsesChange={setResponseData}
                  onResponsesLoadingChange={setResponsesLoading}
                  // raw 탭 선택 = 요약 탭과 동일 브리지 집합(controlled) → 구
                  // 스프레드시트 CTA 통합.
                  selected={bridgeSelected}
                  onToggleRow={toggleBridgeRow}
                  onToggleAll={toggleBridgeAll}
                  // footer("총 N 응답 · ↗ Google Sheets") 는 raw 탭에서만 —
                  // 요약 탭 아래로 새지 않도록(round-2 feedback #4).
                  footerVisible={activeTab === 'raw'}
                />
              }
            />
          }
        />,
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
  interviewProjectId,
  onProjectChange,
}: {
  onPublishedChange?: (published: boolean) => void;
  onConditionsChange?: (brief: EditableBrief | null) => void;
  // 헤더 pill 선택값(interview_projects id). 발행 시 forms/create 에 전달해
  // 새 폼을 이 프로젝트에 stamp 한다. null 이면 서버가 기본 프로젝트로 폴백.
  // 카드 세팅 STEP1 프로젝트 피커의 value 로도 재사용(풀뷰 pill 과 같은 SSOT).
  interviewProjectId?: string | null;
  // STEP1 피커 onChange — 호스트의 handleSelectProject(같은 useProjectSelection
  // scope 'recruiting'). 카드 피커 ↔ 풀뷰 pill 양방향 동기.
  onProjectChange?: (projectId: string | null) => void;
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
          // pill 축 프로젝트 귀속 — 서버가 검증 후 stamp(무효면 기본 폴백).
          interviewProjectId: interviewProjectId ?? null,
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

  const publishStageLabel =
    [
      t('publishStage1'),
      t('publishStage2'),
      t('publishStage3'),
      t('publishStage4'),
    ][publishStageIdx] ?? t('publishing');
  const needsReauth = isReauthError(publishError) && !google?.adminProxy;

  // 하단 CTA — CD `Publish form →` (design-handoff/recruiting). extract·approve
  // 는 이제 step 내 버튼(SourceStep Extract / ReviewBar Approve)이 담당하고,
  // 하단 CTA 는 발행 게이트만: 조건·설문 *양쪽 승인* 전까지 disabled. 승인
  // 완료 시 auto-publish effect 가 발행하며(회귀 0), 이 CTA 는 미발화 edge
  // (OAuth 왕복 후 등)를 위한 수동 트리거로도 동작한다 — triggeredForRef 가
  // 중복 발행을 막는다.
  const bothApproved =
    criteriaPhase === 'approved' && surveyPhase === 'approved';
  const ctaDisabled = !bothApproved || publishing || !!published;

  function handleCta() {
    requireAuth(() => void autoPublish());
  }

  return (
    <div className="flex h-full flex-col">
      <ControlBoardPanel gap="none" fill>
        <ControlBoardPanel.Region fill>
          <RecruitingSetupAccordion
            recruitingProjectId={interviewProjectId ?? null}
            onProjectChange={onProjectChange ?? (() => {})}
            files={files}
            pasted={pasted}
            rejected={rejected}
            running={jobRunning}
            canExtract={canExtract}
            onPasteChange={setPasted}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onExtract={startExtract}
            criteriaPhase={criteriaPhase}
            editedBrief={editedBrief}
            partialCount={partialCriteria.length}
            criteriaError={criteriaError}
            onEditedBriefChange={setEditedBrief}
            onRestart={restartCriteria}
            onApproveCriteria={approveCriteria}
            surveyPhase={surveyPhase}
            survey={survey}
            surveyError={surveyError}
            onSurveyChange={setSurvey}
            onRegenerateSurvey={regenerateSurvey}
            onApproveSurvey={() => requireAuth(() => approveSurvey())}
            google={google}
            googleAuthError={googleAuthError}
            publishing={publishing}
            publishStageIdx={publishStageIdx}
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
          label={t('ctaPublish')}
          busyLabel={t('ctaPublishing')}
          busy={publishing}
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
    // 풀뷰 V2 opt-in — 전체보기를 공유 <FullviewShell>(프레임+사이드바+헤더
    // 스캐폴드)로 렌더하고 본문은 3탭 저니 셸(RecruitingJourneyShell)로.
    fullviewV2: true,
    // 저니 셸 = 2-row 헤더(액션+3탭) + ③ 내부 스크롤 → 1600×940(D2, recruiting
    // 한정). 사이드바 하단 노트 = "풀뷰가 유일 진입"(CD N2).
    fullviewTall: true,
    fullviewFootnoteKey: 'Recruiting.journey.sidebarNote',
  },
  state: 'idle',
  ExpandedBody,
};
