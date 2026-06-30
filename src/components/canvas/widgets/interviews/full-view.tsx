'use client';

import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { IconButton } from '@/components/ui/icon-button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  MAX_FILES,
  useInterviewJob,
  type ConvItem,
  type ConvStatus,
  type IndexStatus,
} from '@/components/interview-job-provider';
import { InterviewSearchPanel } from './search-panel';

// 전체 보기 모달 — 위젯 좁은 화면에서 어색했던 search/chat 을 풀스크린
// 2-column 으로 펼친다. provider 상태 (files / indexStatus / lastSnapshotJobId)
// 를 위젯과 그대로 공유하므로 한 쪽에서 파일 추가/제거하면 다른 쪽도 즉시
// 반영.

const ACCEPT =
  'audio/*,video/*,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function indexStatusLabel(status: IndexStatus): {
  text: string;
  cls: string;
} {
  switch (status) {
    case 'indexing':
      return { text: '인덱싱 중', cls: 'text-amore' };
    case 'done':
      return { text: '인덱싱 완료', cls: 'text-mute' };
    case 'error':
      return { text: '인덱싱 실패', cls: 'text-warning' };
    case 'pending':
      return { text: '인덱싱 대기', cls: 'text-mute-soft' };
    case 'idle':
    default:
      return { text: '분석 후 인덱싱', cls: 'text-mute-soft' };
  }
}

function FileRow({
  item,
  onRemove,
}: {
  item: ConvItem;
  onRemove: () => void;
}) {
  const map: Record<ConvStatus, { text: string; cls: string }> = {
    queued: { text: '대기', cls: 'text-mute-soft' },
    converting: { text: '변환 중', cls: 'text-amore' },
    done: { text: '변환 완료', cls: 'text-amore' },
    error: { text: '실패', cls: 'text-warning' },
  };
  const pill = map[item.status];
  return (
    <li className="border-t border-line-soft first:border-t-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-md text-ink-2">{item.file.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute-soft tabular-nums">
            <span>{formatBytes(item.file.size)}</span>
            <span
              className={`uppercase tracking-[0.22em] font-semibold ${pill.cls}`}
            >
              {pill.text}
            </span>
            {item.extractStatus === 'done' &&
              item.extractTotal !== undefined && (
                <span className="text-mute">Q {item.extractTotal}</span>
              )}
            {item.error && (
              <span className="text-warning">{item.error}</span>
            )}
          </div>
        </div>
        <IconButton
          variant="ghost-danger"
          aria-label="파일 제거"
          onClick={onRemove}
          className="text-sm"
        >
          ✕
        </IconButton>
      </div>
    </li>
  );
}

function FileListPane() {
  const job = useInterviewJob();
  const status = indexStatusLabel(job.indexStatus);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            입력 파일
          </div>
          <div className="mt-1 text-sm text-mute tabular-nums">
            {job.items.length} / {MAX_FILES} · 변환 {job.doneCount} · {' '}
            <span className={`${status.cls} uppercase tracking-[0.18em] font-semibold`}>
              {status.text}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <FileDropZone
          accept={ACCEPT}
          multiple
          disabled={job.items.length >= MAX_FILES}
          onFiles={(files) => job.addFiles(files)}
          label="여기로 파일을 끌어 놓거나 클릭해 추가"
          helperText={
            job.items.length >= MAX_FILES
              ? `최대 ${MAX_FILES}개까지 추가할 수 있어요.`
              : '오디오 / 비디오 / 텍스트 / docx 지원'
          }
          className="py-6"
        />

        {job.items.length > 0 && (
          <ul className="mt-4 border border-line bg-paper rounded-sm">
            {job.items.map((item) => (
              <FileRow
                key={item.id}
                item={item}
                onRemove={() => job.remove(item.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function InterviewFullView({ onClose }: { onClose: () => void }) {
  const job = useInterviewJob();

  // 헤더(제목 + 닫기 ×) 는 WidgetFullviewPanel 이 소유. 이 패널은 공유 모달
  // (CanvasBoard FullviewShell) slot 으로 portal 된다 (interviews-card).
  return (
    <WidgetFullviewPanel
      title="인터뷰 결과 — 전체 보기"
      subtitle="파일을 추가하고 코퍼스 안에서 검색·질문하세요."
      onClose={onClose}
    >
      {/* 본문 — 좌(파일 list) 5/12 + 우(검색/채팅) 7/12. 작은 화면에서는
          세로 스택. */}
      <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-12">
        <aside className="lg:col-span-5 lg:border-r border-line-soft min-h-0 max-h-[40vh] lg:max-h-none overflow-hidden border-b lg:border-b-0">
          <FileListPane />
        </aside>
        <section className="lg:col-span-7 min-h-0 overflow-hidden">
          <InterviewSearchPanel
            jobId={job.lastSnapshotJobId}
            indexStatus={job.indexStatus}
          />
        </section>
      </div>
    </WidgetFullviewPanel>
  );
}
