'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptFileList — 전사 풀뷰 V2 파일 리스트 (CD state 04).
   design-handoff/FULLVIEW-SHELL.md §F4 Transcript · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 quotes fullview 리스트 프레젠테이션은 supersede).
   파일행 3-상태(done/processing/failed) 를 CD 클래스맵대로 렌더한다:
   - done: border-2 ink · rounded-sm · shadow-memphis-sm-faint · paper, 클릭 →
     상세(state 05). 우측 ✓ Done 칩(success) + 개별 삭제.
   - processing: border-line · bg-lav-bg-2 · Transcribing 칩(lav). % 소스 없음
     (binary) → indeterminate 라벨만(BUILD-SPEC §6).
   - failed: 비-done 프레임(lav tint) + Failed 칩(error) + 재시도/삭제.

   완료 job 관리 액션 복구 (parity): 헤더 전체 선택 + 행 체크박스 + 선택 시
   벌크 툴바(zip 다운로드/삭제) + done/failed 행 개별 삭제 + failed 재시도.
   전부 소비처(quotes-card-body)의 기존 핸들러를 `actions` 로 배선 — 재구현 0.
   (CD state 04 "브라우징 전용" 노트는 이 parity 복구로 supersede.)
   ──────────────────────────────────────────────────────────────────── */

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import type { TranscriptJob } from '@/components/transcript-job-provider';
import type { TranscriptFullviewActions } from './transcript-fullview-body';
import {
  fileIcon,
  fileRowState,
  formatDate,
  minutesFromSeconds,
  stripExt,
  type FileRowState,
} from './transcript-format';

// CD F() 3-상태 → 유틸리티 클래스맵. 행 프레임(비-done 은 lav tint) + 상태 칩.
const ROW_CLASS: Record<FileRowState, string> = {
  done: 'border-ink bg-paper shadow-memphis-sm-faint',
  processing: 'border-line bg-lav-bg-2',
  failed: 'border-line bg-lav-bg-2',
};
const ICON_BG: Record<FileRowState, string> = {
  done: 'bg-lav',
  processing: 'bg-lav-bg-3',
  failed: 'bg-lav-bg-3',
};
const CHIP_CLASS: Record<FileRowState, string> = {
  done: 'border-success-line bg-success-bg text-success-text',
  processing: 'border-lav-text/30 bg-lav-bg-3 text-lav-text',
  failed: 'border-error-line bg-error-line/30 text-error-text',
};

function FileRow({
  job,
  stuck,
  selected,
  onToggleSelect,
  onOpen,
  onDelete,
  onRetry,
}: {
  job: TranscriptJob;
  stuck: boolean;
  selected: boolean;
  onToggleSelect: (on: boolean) => void;
  onOpen?: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('Features.transcriptsView');
  const tResult = useTranslations('Features.transcriptResult');
  const locale = useLocale();
  const state = fileRowState(job.status, stuck);
  const isDone = state === 'done';
  const isFailed = state === 'failed';

  const name = stripExt(job.filename) || tResult('kind');
  const meta =
    state === 'processing'
      ? // % 소스 없음(binary) → indeterminate 진행 라벨만.
        t('inProgress')
      : state === 'failed'
        ? (job.error_message ?? t('statusError'))
        : [
            minutesFromSeconds(job.duration_seconds) != null
              ? tResult('minutes', { min: minutesFromSeconds(job.duration_seconds)! })
              : null,
            job.speakers_count != null
              ? tResult('speakers', { count: job.speakers_count })
              : null,
            // language 는 job provider 가 안 실어(turns meta 에만 존재) — 리스트
            // 메타에선 생략(상세뷰 헤더/툴바에서 노출).
            formatDate(job.created_at, locale),
          ]
            .filter(Boolean)
            .join(' · ');

  const chipLabel =
    state === 'done'
      ? t('statusDone')
      : state === 'failed'
        ? t('statusError')
        : t('statusTranscribing');

  // 아이콘 + 이름/메타 + 상태칩. done 행에선 클릭 타깃(→ 상세) 안, 그 외엔
  // 정적 영역. 체크박스/행 액션은 이 영역 밖 형제라 nested-interactive 회피.
  const inner = (
    <>
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--fv-radius-field)] border-2 border-ink text-lg ${ICON_BG[state]}`}
      >
        {fileIcon(job.mime_type, job.filename)}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-mono-label text-lg font-bold text-ink">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-sm text-mute-soft">{meta}</span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.4px] px-[11px] py-1 text-sm font-bold ${CHIP_CLASS[state]}`}
      >
        {state === 'done' ? <span aria-hidden>✓</span> : null}
        {chipLabel}
      </span>
    </>
  );

  const clickable = isDone && !!onOpen;
  const rowClass = `flex items-center gap-[14px] rounded-sm border-2 px-4 py-[14px] ${ROW_CLASS[state]}${
    clickable ? ' transition-[box-shadow] hover:shadow-memphis-sm' : ''
  }`;

  return (
    <div className={rowClass}>
      <Checkbox
        checked={selected}
        onChange={(e) => onToggleSelect(e.target.checked)}
        aria-label={t('selectAria', { filename: name })}
      />
      {clickable ? (
        // eslint-disable-next-line react/forbid-elements -- CD state 04 파일행 본문(아이콘+이름/메타+상태칩+chevron)은 단일 클릭 타깃(→ 상세 state 05). Button primitive variant 는 이 행 레이아웃(좌측 정렬·flex-1)과 불일치 — fullview-header 닫기✕ 선례(§7.11 className radius override 불가).
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-[14px] text-left"
        >
          {inner}
          <span aria-hidden className="text-xl text-ink">
            ›
          </span>
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-[14px]">{inner}</div>
      )}
      {isFailed && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
      {(isDone || isFailed) && (
        <IconButton
          variant="ghost-danger"
          aria-label={t('deleteJobAria')}
          onClick={onDelete}
          className="text-sm"
        >
          ✕
        </IconButton>
      )}
    </div>
  );
}

export function TranscriptFileList({
  jobs,
  stuckIds,
  onOpen,
  actions,
}: {
  jobs: TranscriptJob[];
  // 멈춤/실패(오래된 submitting/transcribing + error) job id 집합 → failed 상태.
  stuckIds: Set<string>;
  // done 파일행 클릭 → 상세(state 05). done 이 아니면 미호출.
  onOpen: (job: TranscriptJob) => void;
  actions: TranscriptFullviewActions;
}) {
  const t = useTranslations('Features.transcriptsView');

  if (jobs.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-[18px]">
        <p className="py-10 text-center text-lg text-mute-soft">{t('noJobs')}</p>
      </div>
    );
  }

  // 전체 선택 상태 — 현재 보이는 목록 기준(레거시 fullview 동형).
  const visibleIds = jobs.map((j) => j.id);
  const selectedVisible = visibleIds.filter((id) => actions.selected.has(id));
  const allSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const selectedList = Array.from(actions.selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 헤더 — 전체 선택 + (선택 시) 벌크 툴바. 스크롤 영역 밖(shrink-0)이라
          목록을 스크롤해도 항상 보인다. */}
      <div className="shrink-0 border-b border-line-soft px-6 pb-3 pt-[18px]">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-mute-soft">
          <Checkbox
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => actions.selectVisible(visibleIds, e.target.checked)}
            aria-label={t('selectAll')}
          />
          {t('selectAll')}
        </label>

        {/* 벌크 툴바 — 선택 1개 이상일 때만. 다운로드는 confirm 없이 바로,
            삭제는 confirm 모달(소비처 소유). */}
        {actions.selected.size > 0 && (
          <div className="mt-3 flex items-center gap-3 rounded-sm border-2 border-ink bg-amore-bg px-4 py-2 shadow-memphis-sm-faint">
            <span className="text-sm font-semibold text-ink-2">
              {t('nSelected', { count: actions.selected.size })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="link" size="sm" onClick={actions.clearSelection}>
                {t('clearSelection')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => actions.bulkDownload(selectedList)}
              >
                {t('zipDownload', { count: actions.selected.size })}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={actions.requestBulkDelete}
                disabled={actions.bulkBusy}
              >
                {t('bulkDeleteBtn', { count: actions.selected.size })}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 파일행 목록 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-[18px]">
        {jobs.map((j) => (
          <FileRow
            key={j.id}
            job={j}
            stuck={stuckIds.has(j.id)}
            selected={actions.selected.has(j.id)}
            onToggleSelect={(on) => actions.toggleSelect(j.id, on)}
            onOpen={j.status === 'done' ? () => onOpen(j) : undefined}
            onDelete={() => actions.deleteJob(j.id)}
            onRetry={() => actions.retryJob(j.id)}
          />
        ))}
      </div>
    </div>
  );
}
