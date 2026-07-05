'use client';

import type { DeskJob, DeskJobStatus } from '@/components/desk-job-provider';

// 데스크 fullview 좌측 "이전 산출물" 리스트. useDeskJobs().jobs (DB persist,
// 최근 20개, 신 → 옛 순서) 를 그대로 렌더 — 카드 본문은 세션 스코프
// latestJob 만 보여주므로, 옛 완료 job 은 여기서만 접근 가능하다.
export function DeskJobHistoryList({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: DeskJob[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-1 p-3">
      <h3 className="px-2 py-1 text-xs-soft uppercase tracking-[.18em] text-mute-soft">
        이전 산출물 ({jobs.length})
      </h3>
      {jobs.map((job) => {
        const active = selectedJobId === job.id;
        return (
          /* eslint-disable-next-line react/forbid-elements -- custom full-width multiline list-row selector; Button primitive capsule chrome unsuitable (qa-feedback-list 와 동일 패턴) */
          <button
            key={job.id}
            type="button"
            onClick={() => onSelect(job.id)}
            aria-current={active ? 'true' : undefined}
            className={`flex flex-col gap-0.5 rounded-xs px-3 py-2 text-left transition-colors ${
              active
                ? 'border-l-2 border-amore bg-amore-bg'
                : 'border-l-2 border-transparent hover:bg-paper'
            }`}
          >
            <span
              className={`line-clamp-1 text-sm ${active ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}
            >
              {job.keywords.length > 0 ? job.keywords.join(', ') : '(키워드 없음)'}
            </span>
            <span className="text-xs-soft text-mute-soft">
              {formatCreatedAt(job.created_at)}
            </span>
            <span className="text-xs-soft text-mute">{statusLabel(job.status)}</span>
          </button>
        );
      })}
      {jobs.length === 0 && (
        <p className="px-2 py-4 text-xs text-mute-soft">아직 산출물이 없어요</p>
      )}
    </nav>
  );
}

function statusLabel(status: DeskJobStatus): string {
  switch (status) {
    case 'done':
      return '✓ 완료';
    case 'error':
      return '⚠ 에러';
    case 'cancelled':
      return '○ 취소됨';
    default:
      return '🔄 진행중';
  }
}

function formatCreatedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
