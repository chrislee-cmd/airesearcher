'use client';

import type { WidgetContent } from '../widget-types';
import { InterviewAnalyzer } from '@/components/interview-analyzer';
import { WidgetOutputs } from '../shell/widget-outputs';

function ExpandedBody() {
  // body 는 flex column — 분석 UI 는 중간 (flex-1, 자체 스크롤), 산출물
  // 영역은 카드 바닥에 고정 (quotes / desk 와 시각 통일). 인터뷰는 아직
  // 결과 history 가 없어서 items=[] 로 항상 빈 상태 placeholder 노출.
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <InterviewAnalyzer />
      </div>
      <WidgetOutputs label="최근 산출물" items={[]} renderItem={() => null} />
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
    thumbnail: '/thumbnail/interview.png',
    description:
      '여러 인터뷰 파일을 .md 로 변환하고, 공통 문항별 답변 요약 + VOC 인용 표로 정리합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
