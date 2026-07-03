'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { InterviewAnalysisArea } from '@/components/interview-analyzer';
import { useInterviewJob } from '@/components/interview-job-provider';
import { prefillKey } from '@/lib/workspace';
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

  // 위젯 업로드 완료 → fullview 와 동일하게 방금 저장한 프로젝트 상세로 이동.
  const handleUploaded = (projectId: string) => {
    setUploadOpen(false);
    setPendingProjectId(projectId);
    openFullview();
  };

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

      {/* 업로드 모달 — V2 프로젝트-설정 gate 업로드 (전체보기와 동일 flow).
          파일 선택 → 프로젝트 선택/생성 → 업로드 → 해당 프로젝트 전체보기로
          이동. project 미지정으로 열어 Step 2(프로젝트 설정)를 강제. */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <InterviewAnalysisArea />
      </div>
      {/* 상태 푸터 — 진행중이면 "분석이 진행중", 완료면 "분석이
          완료되었습니다"(클릭 → fullview: 2-column list + 검색/채팅).
          진행중 우선. */}
      {(running || isComplete) && (
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
      )}
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
