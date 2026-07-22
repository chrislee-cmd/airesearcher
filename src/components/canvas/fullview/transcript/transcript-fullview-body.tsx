'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptFullviewBody — 전사 풀뷰 V2 본문 (CD state 04 · 05).
   design-handoff/FULLVIEW-SHELL.md §F4 Transcript.

   FullviewShell 우측 슬롯(헤더 아래)에 portal 되는 본문. resultJob 선택
   여부로 파일 리스트(state 04) ↔ 상세(state 05)를 전환한다. 헤더 슬롯
   (프로젝트 pill · Done 배지)은 소비처(quotes-card-body)가 renderInHeader*
   로 주입 — 이 본문은 우측 슬롯 콘텐츠만 소유.

   fresh 신규 빌드 (레거시 quotes fullview 리스트 · transcript-result-fullview
   프레젠테이션은 supersede — 로직만 재사용).
   ──────────────────────────────────────────────────────────────────── */

import type { TranscriptJob } from '@/components/transcript-job-provider';
import { TranscriptFileList } from './transcript-file-list';
import { TranscriptDetail } from './transcript-detail';

export function TranscriptFullviewBody({
  jobs,
  stuckIds,
  resultJob,
  onOpenResult,
  onBackToList,
}: {
  jobs: TranscriptJob[];
  stuckIds: Set<string>;
  // 상세로 보고 있는 잡. null 이면 파일 리스트(state 04).
  resultJob: TranscriptJob | null;
  onOpenResult: (job: TranscriptJob) => void;
  onBackToList: () => void;
}) {
  if (resultJob) {
    return <TranscriptDetail job={resultJob} onBack={onBackToList} />;
  }
  return (
    <TranscriptFileList jobs={jobs} stuckIds={stuckIds} onOpen={onOpenResult} />
  );
}
