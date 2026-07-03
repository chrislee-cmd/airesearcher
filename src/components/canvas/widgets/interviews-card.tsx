'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { InterviewAnalysisArea } from '@/components/interview-analyzer';
import { useInterviewJob } from '@/components/interview-job-provider';
import { useInterviewV2Upload } from '@/hooks/use-interview-v2-upload';
import { prefillKey } from '@/lib/workspace';
import { JobProgress } from '@/components/ui/job-progress';
import { WidgetSubHeader } from '../shell/widget-subheader';
import { WidgetUploadButton } from '../shell/widget-upload-button';
import { OnboardingTooltip } from '../../ui/onboarding-tooltip';
import { UploadModal } from '@/components/interviews-v2/upload-modal';
import { useWidgetState } from '../shell/widget-state-context';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import { InterviewV2Fullview } from '@/components/interviews-v2/interview-v2-fullview';
import { track as trackEvent } from '@/lib/analytics/events';

// 헤더 pill 로 push 할 live state. interview job provider 의 isWorking
// (변환 / 분석 / extract 중 하나라도 진행 중) → running, label = phase.
// 파일 변환 진행률은 queued / done 잡 count 로 추정. done 항목 있으면
// done, error 있으면 error.
function InterviewStatePush() {
  const { setState } = useWidgetState();
  const job = useInterviewJob();
  const items = job.items;
  const queuedCount = job.queuedCount;
  const doneCount = job.doneCount;
  const errorItem = items.find((i) => i.status === 'error') ?? null;

  useEffect(() => {
    if (job.analyzing || job.summarizing || job.verticallySynthesizing) {
      const label = job.summarizing
        ? 'SUMMARIZING'
        : job.verticallySynthesizing
          ? 'SYNTHESIZING'
          : 'ANALYZING';
      setState({ kind: 'running', label });
      return;
    }
    if (job.convertingAll || items.some((i) => i.status === 'converting')) {
      const total = items.filter(
        (i) => i.status !== 'error' && i.status !== 'queued',
      ).length + queuedCount;
      const progress =
        total > 0
          ? Math.min(99, Math.round((doneCount / total) * 100))
          : undefined;
      setState({ kind: 'running', label: 'CONVERTING', progress });
      return;
    }
    if (job.indexStatus === 'indexing') {
      setState({ kind: 'running', label: 'INDEXING' });
      return;
    }
    if (job.analyzeError || job.summarizeError || job.verticalSynthError) {
      setState({
        kind: 'error',
        message:
          job.analyzeError ??
          job.summarizeError ??
          job.verticalSynthError ??
          undefined,
      });
      return;
    }
    if (errorItem) {
      setState({ kind: 'error', message: errorItem.error ?? undefined });
      return;
    }
    if (job.analysis || doneCount > 0) {
      setState({ kind: 'done' });
      return;
    }
    setState({ kind: 'idle' });
  }, [
    setState,
    items,
    queuedCount,
    doneCount,
    errorItem,
    job.analyzing,
    job.summarizing,
    job.verticallySynthesizing,
    job.convertingAll,
    job.indexStatus,
    job.analyzeError,
    job.summarizeError,
    job.verticalSynthError,
    job.analysis,
  ]);

  return null;
}

function ExpandedBody() {
  // body 는 flex column — 분석 UI 는 중간 (flex-1, 자체 스크롤). 산출물
  // 목록은 "전체 보기" modal 로 일원화 (하단 "최근 산출물" 푸터 제거).
  //
  // "전체 보기" → InterviewFullView (풀스크린 2-column — 좌: 파일 list,
  // 우: 검색/채팅). 위젯이 좁아서 search query / chat 이 어색하다는 사용자
  // 피드백 대응. 공유 모달(CanvasBoard FullviewShell)이 소유하고 interviews
  // 가 currentKey 일 때만 본문을 모달 slot 으로 portal. provider
  // (useInterviewJob) 기반이라 모달 close 후 파일/인덱스 상태 보존.
  const { renderInSlot, openFullview, close } = useFullview('interviews');
  const tWidgets = useTranslations('Widgets');
  const job = useInterviewJob();
  // 업로드 모달 open state — 📤 업로드 버튼이 V2 프로젝트-설정 gate 업로드
  // 모달(UploadModal)을 연다. 전체보기(fullview)와 완전히 동일한 flow.
  const [uploadOpen, setUploadOpen] = useState(false);
  // 위젯 업로드 완료 후 열 전체보기의 대상 프로젝트. 일반 "전체 보기" CTA 는
  // null 로 비워 목록부터, 업로드 직후엔 방금 저장한 프로젝트 상세로 진입.
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  // V2 업로드 lifecycle 을 위젯이 소유 — 모달은 파일/프로젝트만 정하고 닫히고
  // (delegate 모드), 실제 변환+인덱싱 진행률은 위젯 본문 프로그레스 바로,
  // 완료는 하단 푸터로 노출한다.
  const v2Upload = useInterviewV2Upload();
  // 방금 업로드한 대상 프로젝트 (완료 푸터의 "전체 보기" 진입점).
  const [uploadTargetProject, setUploadTargetProject] = useState<string | null>(
    null,
  );
  // 성공 완료 nonce — 값이 오르면 완료 푸터 재노출(WidgetStatusFooter resetKey).
  const [uploadDoneNonce, setUploadDoneNonce] = useState(0);

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'interviews' });
  }, []);

  // 통일 "전체 보기" 진입 계측. 일반 진입은 프로젝트 목록부터 (pending 비움).
  const handleInterviewsFullview = () => {
    trackEvent('widget_action', {
      widget: 'interviews',
      action: 'fullview_open',
    });
    trackEvent('widget_viewed', { widget: 'interviews', fullview: true });
    setPendingProjectId(null);
    openFullview();
  };

  // 모달에서 파일+프로젝트가 정해지면(delegate) 모달은 이미 닫힌 상태 —
  // 위젯이 업로드를 돌리고 본문 프로그레스 바 + 완료 푸터로 진행을 노출.
  const handleUploadSubmit = (files: File[], projectId: string) => {
    setUploadTargetProject(projectId);
    void v2Upload.uploadMany(files, projectId).then((ok) => {
      if (ok) setUploadDoneNonce((n) => n + 1);
    });
  };

  // 완료 푸터 "전체 보기" → 방금 업로드한 프로젝트 상세로 진입.
  const openUploadedProject = () => {
    setPendingProjectId(uploadTargetProject);
    openFullview();
  };

  // V2 업로드 진행/완료 파생값. converting → indexing → done 3단계를 거친
  // 배치라 done-count 는 끝에 몰려 튄다. 단계 기반 coarse % 로 부드럽게.
  const v2Total = v2Upload.items.length;
  const v2DoneCount = v2Upload.items.filter((i) => i.status === 'done').length;
  const v2Progress =
    v2Total === 0
      ? 0
      : v2DoneCount === v2Total
        ? 100
        : v2Upload.items.some((i) => i.status === 'indexing')
          ? 66
          : 33;
  // 완료 = busy 아님 + 성공 nonce 1+ (업로드가 최소 1회 성공).
  const v2UploadDone = !v2Upload.busy && uploadDoneNonce > 0;

  // Workspace "send to" → interviews prefill. InterviewUploadArea 도 같은
  // 처리를 하지만, 이제 그 컴포넌트가 업로드 모달 안에서만 마운트되므로
  // (모달 닫힘 = unmount) 위젯 마운트 시점에 바로 큐에 넣으려면 여기서도
  // 한 번 소비한다. sessionStorage.removeItem 이 idempotent 가드라 두
  // 곳이 동시에 큐잉하지 않는다 (먼저 마운트되는 쪽이 key 를 소비).
  useEffect(() => {
    try {
      const k = prefillKey('interviews');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const f = new File([raw], `workspace_${stamp}.md`, {
        type: 'text/markdown',
      });
      job.addFiles([f]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 진행중 = 변환/분석/인덱싱 중 하나라도 (헤더 running pill 과 동일 판정 —
  // InterviewStatePush 참고). 완료 = 분석 결과 존재 또는 변환 완료 1건+.
  const running =
    job.analyzing ||
    job.summarizing ||
    job.verticallySynthesizing ||
    job.convertingAll ||
    job.items.some((i) => i.status === 'converting') ||
    job.indexStatus === 'indexing';
  const isComplete = !!job.analysis || job.doneCount > 0;
  // 온보딩 게이팅 — 아직 아무 파일도 없음 (변환 큐·업로드 항목 0, 완료·진행중
  // 아님). 이 동안만 📤 pulse + "파일을 먼저 업로드" hint. 변환 CTA 는
  // 업로드 모달(InterviewUploadArea) 안에 있어 gated-CTA hint 대신 서브헤더
  // hint 슬롯을 쓴다.
  const noFiles = job.items.length === 0 && !isComplete && !running;
  return (
    <div className="flex h-full flex-col">
      <InterviewStatePush />
      {/* WidgetSubHeader — 통일 컴팩트: 좌 = 📤 업로드 버튼 하나. 클릭 시
          V2 프로젝트-설정 gate 업로드 모달(전체보기와 동일 flow)을 연다. */}
      <WidgetSubHeader
        compact
        inputs={
          <OnboardingTooltip
            id="widget-interviews"
            message={tWidgets('onboardingUpload')}
            dismissLabel={tWidgets('onboardingDismiss')}
          >
            <WidgetUploadButton
              onClick={() => setUploadOpen(true)}
              label={tWidgets('upload')}
              count={job.queuedCount}
              pulse={noFiles}
            />
          </OnboardingTooltip>
        }
        hint={noFiles ? <span>{tWidgets('uploadHint')}</span> : undefined}
      />

      {/* 업로드 모달 — V2 프로젝트-설정 gate (delegate 모드). 파일 선택 →
          프로젝트 선택/생성 → "업로드" 클릭 시 모달은 즉시 닫히고, 위젯이
          업로드를 이어받아 본문 프로그레스 바 + 완료 푸터로 진행을 노출. */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleUploadSubmit}
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {/* V2 업로드 진행 프로그레스 바 — 모달이 닫힌 뒤 위젯 본문 상단에서
            변환/인덱싱 진행률을 노출. */}
        {v2Upload.busy && (
          <JobProgress
            value={v2Progress}
            label={tWidgets('interviewUploadProgress')}
            hint={v2Total > 0 ? `${v2DoneCount}/${v2Total}` : undefined}
          />
        )}
        <InterviewAnalysisArea />
      </div>
      {/* 상태 푸터 — V2 업로드 우선: 진행중은 본문 프로그레스 바가 맡고,
          완료 시 여기 "업로드가 완료되었습니다"(클릭 → 해당 프로젝트 전체보기).
          V2 업로드가 없을 때만 레거시 분석 진행/완료 푸터로 폴백. */}
      {v2Upload.busy ? null : v2UploadDone ? (
        <WidgetStatusFooter
          status="done"
          label={tWidgets('interviewUploadDone')}
          viewAllLabel={tWidgets('viewAll')}
          count={v2DoneCount}
          resetKey={`v2upload-${uploadDoneNonce}`}
          onClick={openUploadedProject}
        />
      ) : running || isComplete ? (
        <WidgetStatusFooter
          status={running ? 'running' : 'done'}
          label={
            running ? tWidgets('interviewRunning') : tWidgets('interviewDone')
          }
          viewAllLabel={tWidgets('viewAll')}
          count={job.doneCount}
          resetKey={
            running ? 'running' : `done-${job.doneCount}-${job.analysis ? 1 : 0}`
          }
          onClick={handleInterviewsFullview}
        />
      ) : null}
      {renderInSlot(
        <InterviewV2Fullview
          onClose={close}
          initialProjectId={pendingProjectId}
        />,
      )}
    </div>
  );
}

// 인터뷰 결과 생성기 canvas widget — 기존 /interviews 페이지의 InterviewAnalyzer
// 를 그대로 canvas widget body 로 마운트. accent 는 moderator 와 같은 peach
// 재사용 (썸네일이 시각 식별자 우선, accent 는 thumbnail 없을 때만 노출되는
// fallback — moderator visibility=false 상태라 시각 충돌 X).
export const interviewsCard: WidgetContent = {
  key: 'interviews',
  meta: {
    label: '인터뷰 결과 생성기',
    accent: 'peach',
    cost: 10,
    thumbnail: '/thumbnail/analysis.png',
    description:
      '여러 인터뷰 파일을 .md 로 변환하고, 공통 문항별 답변 요약 + VOC 인용 표로 정리합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
