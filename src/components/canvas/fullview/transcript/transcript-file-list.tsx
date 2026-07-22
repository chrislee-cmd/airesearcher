'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptFileList — 전사 풀뷰 V2 파일 리스트 (CD state 04).
   design-handoff/FULLVIEW-SHELL.md §F4 Transcript · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 quotes fullview 리스트 프레젠테이션은 supersede).
   파일행 3-상태(done/processing/failed) 를 CD 클래스맵대로 렌더한다:
   - done: border-2 ink · rounded-sm · shadow-memphis-sm-faint · paper, 클릭 →
     상세(state 05). 우측 ✓ Done 칩(success).
   - processing: border-line · bg-lav-bg-2 · Transcribing 칩(lav). % 소스 없음
     (binary) → indeterminate 라벨만(BUILD-SPEC §6).
   - failed: 비-done 프레임(lav tint) + Failed 칩(error). 재시도/삭제는 카드
     본문 큐 UI 가 소유(레거시 유지) — 리스트는 CD 대로 브라우징/열람 전용.

   삭제·재시도·일괄선택은 CD state 04 에 없어 이 fresh 리스트에는 미포함 —
   해당 액션은 카드 본문(ExpandedBody)의 큐/산출물 UI 에 그대로 남아 회귀 0.
   ──────────────────────────────────────────────────────────────────── */

import { useLocale, useTranslations } from 'next-intl';
import type { TranscriptJob } from '@/components/transcript-job-provider';
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
  onOpen,
}: {
  job: TranscriptJob;
  stuck: boolean;
  onOpen?: () => void;
}) {
  const t = useTranslations('Features.transcriptsView');
  const tResult = useTranslations('Features.transcriptResult');
  const locale = useLocale();
  const state = fileRowState(job.status, stuck);
  const isDone = state === 'done';

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
      <span aria-hidden className={`text-xl ${isDone ? 'text-ink' : 'text-line-empty'}`}>
        ›
      </span>
    </>
  );

  const rowClass = `flex items-center gap-[14px] rounded-sm border-2 px-4 py-[14px] ${ROW_CLASS[state]}`;

  if (isDone && onOpen) {
    return (
      // eslint-disable-next-line react/forbid-elements -- CD state 04 파일행은 아이콘+이름/메타+상태칩+chevron 전체가 단일 클릭 타깃(→ 상세 state 05). Button primitive variant 는 이 카드 레이아웃(행 프레임·상태별 tint·좌측 정렬)과 불일치 — fullview-header 닫기✕ 와 동일 선례(§7.11 className radius override 불가).
      <button
        type="button"
        onClick={onOpen}
        className={`${rowClass} w-full text-left transition-[box-shadow] hover:shadow-memphis-sm`}
      >
        {inner}
      </button>
    );
  }
  return <div className={rowClass}>{inner}</div>;
}

export function TranscriptFileList({
  jobs,
  stuckIds,
  onOpen,
}: {
  jobs: TranscriptJob[];
  // 멈춤/실패(오래된 submitting/transcribing + error) job id 집합 → failed 상태.
  stuckIds: Set<string>;
  // done 파일행 클릭 → 상세(state 05). done 이 아니면 미호출.
  onOpen: (job: TranscriptJob) => void;
}) {
  const t = useTranslations('Features.transcriptsView');

  if (jobs.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-[18px]">
        <p className="py-10 text-center text-lg text-mute-soft">{t('noJobs')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-[18px]">
      {jobs.map((j) => (
        <FileRow
          key={j.id}
          job={j}
          stuck={stuckIds.has(j.id)}
          onOpen={j.status === 'done' ? () => onOpen(j) : undefined}
        />
      ))}
    </div>
  );
}
