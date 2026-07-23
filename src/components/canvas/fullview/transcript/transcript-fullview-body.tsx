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

   완료 job 관리 액션(벌크 선택/다운로드/삭제·개별 삭제·실패 재시도)은
   `/transcripts` page chrome 에만 있고 캔버스 modal fullview 엔 누락돼 있었다.
   완료 job 은 캔버스에서 fullview 외 노출처가 없어 관리 불가 → 여기서 복구.
   전부 소비처(quotes-card-body)의 기존 핸들러를 `actions` 로 배선만 한다
   (신규 백엔드/라우트 0). CD state 04 "브라우징 전용" 노트는 이 parity 복구로
   supersede — 체크박스/툴바/행 액션이 리스트에 추가된다.
   ──────────────────────────────────────────────────────────────────── */

import type { TranscriptJob } from '@/components/transcript-job-provider';
import { TranscriptFileList } from './transcript-file-list';
import { TranscriptDetail } from './transcript-detail';

// 파일 리스트(state 04)가 배선하는 완료 job 관리 액션. 전부 소비처
// (quotes-card-body)의 기존 상태/핸들러를 그대로 넘겨받는다 — 재구현 0.
export type TranscriptFullviewActions = {
  // 선택된 job id 집합 (소비처 소유). 벌크 다운로드/삭제 대상.
  selected: Set<string>;
  // 행 체크박스 토글.
  toggleSelect: (id: string, on: boolean) => void;
  // 헤더 전체 선택/해제 — 현재 보이는 목록 기준.
  selectVisible: (ids: string[], on: boolean) => void;
  clearSelection: () => void;
  // 벌크 zip 다운로드 (bulk-download 라우트 재사용, confirm 없음).
  bulkDownload: (ids: string[]) => void;
  // 벌크 삭제 confirm 모달 열기 (모달 자체는 소비처가 소유).
  requestBulkDelete: () => void;
  // 병렬 DELETE inflight 동안 벌크 버튼 비활성.
  bulkBusy: boolean;
  // 완료/실패 job 개별 삭제 (DELETE /jobs/[id] 재사용).
  deleteJob: (id: string) => void;
  // 멈춤/실패 job 재시도 (POST /jobs/[id]/retry 재사용).
  retryJob: (id: string) => void;
};

export function TranscriptFullviewBody({
  jobs,
  stuckIds,
  resultJob,
  onOpenResult,
  onBackToList,
  actions,
}: {
  jobs: TranscriptJob[];
  stuckIds: Set<string>;
  // 상세로 보고 있는 잡. null 이면 파일 리스트(state 04).
  resultJob: TranscriptJob | null;
  onOpenResult: (job: TranscriptJob) => void;
  onBackToList: () => void;
  actions: TranscriptFullviewActions;
}) {
  if (resultJob) {
    return <TranscriptDetail job={resultJob} onBack={onBackToList} />;
  }
  return (
    <TranscriptFileList
      jobs={jobs}
      stuckIds={stuckIds}
      onOpen={onOpenResult}
      actions={actions}
    />
  );
}
