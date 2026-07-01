'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import {
  InterviewAnalysisArea,
  InterviewUploadArea,
} from '@/components/interview-analyzer';
import { useInterviewJob } from '@/components/interview-job-provider';
import { WidgetSubHeader } from '../shell/widget-subheader';
import { useWidgetState } from '../shell/widget-state-context';
import { useFullview } from '../shell/fullview-shell-context';
import { WidgetStatusFooter } from '../shell/widget-status-footer';
import { InterviewFullView } from './interviews/full-view';

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
  return (
    <div className="flex h-full flex-col">
      <InterviewStatePush />
      {/* WidgetSubHeader — 업로드 영역 (inputs).
          사용자 요청으로 "1단계 — 파일을 .md로 변환" 타이틀은 제거됨. */}
      <WidgetSubHeader inputs={<InterviewUploadArea />} />
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
          onClick={openFullview}
        />
      )}
      {renderInSlot(<InterviewFullView onClose={close} />)}
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
