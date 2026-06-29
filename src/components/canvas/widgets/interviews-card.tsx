'use client';

import { useEffect, useState } from 'react';
import type { WidgetContent } from '../widget-types';
import { InterviewAnalyzer } from '@/components/interview-analyzer';
import { useInterviewJob } from '@/components/interview-job-provider';
import { WidgetOutputs } from '../shell/widget-outputs';
import { useWidgetState } from '../shell/widget-state-context';
import { Button } from '@/components/ui/button';
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
  // body 는 flex column — 분석 UI 는 중간 (flex-1, 자체 스크롤), 산출물
  // 영역은 카드 바닥에 고정 (quotes / desk 와 시각 통일). 인터뷰는 아직
  // 결과 history 가 없어서 items=[] 로 항상 빈 상태 placeholder 노출.
  //
  // 우상단 "전체 보기" 버튼 → InterviewFullView 모달 (풀스크린 2-column —
  // 좌: 파일 list, 우: 검색/채팅). 위젯이 좁아서 search query / chat 이
  // 어색하다는 사용자 피드백 대응.
  const [fullViewOpen, setFullViewOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <InterviewStatePush />
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-line-soft px-5 py-2">
        <Button
          variant="link"
          size="xs"
          onClick={() => setFullViewOpen(true)}
          className="!text-sm uppercase tracking-[0.18em]"
        >
          ⤢ 전체 보기
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <InterviewAnalyzer />
      </div>
      <WidgetOutputs label="최근 산출물" items={[]} renderItem={() => null} />
      <InterviewFullView
        open={fullViewOpen}
        onClose={() => setFullViewOpen(false)}
      />
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
