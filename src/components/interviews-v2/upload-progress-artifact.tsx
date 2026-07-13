'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';
import {
  useInterviewUpload,
  type UploadBatch,
  type UploadFileStatus,
} from '@/components/interview-upload-provider';

// Interview V2 — inline upload progress surface
// (pr-interview-upload-background-progress-artifact).
//
// The upload used to run inside <UploadModal>, blocking the app and dropping
// all progress when the modal closed. The convert/index pipeline now lives in
// the app-level InterviewUploadProvider (survives modal close + navigation),
// and its progress renders HERE — inline, in the widget card's control-board
// slot (사용자 결정: 우측 하단 플로팅 패널이 아니라 ControlDropzone 자리에 아티팩트
// 처럼 배치). While a batch is in flight for the active project the card swaps
// its dropzone for this progress (업로드 뷰에선 dropzone 불필요).
//
// Data: the provider's per-file status (N/M · stage counts · aggregate %) plus
// per-file failures (#1007). A clean batch auto-dismisses after a short delay;
// a batch with failures stays until the user dismisses it so the failed
// filenames don't vanish before they're seen.

const AUTO_DISMISS_MS = 6000;

type Group = 'processing' | 'indexing' | 'done' | 'error' | 'duplicate';

function groupOf(status: UploadFileStatus): Group {
  switch (status) {
    case 'queued':
    case 'converting':
    case 'retrying':
      return 'processing';
    case 'indexing':
      return 'indexing';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'duplicate':
      return 'duplicate';
  }
}

// Is there any (non-dismissed) upload batch for this project? The card uses
// this to swap its dropzone for the inline progress while a batch runs.
export function useHasInterviewUploadFor(projectId: string | null): boolean {
  const { batches } = useInterviewUpload();
  if (!projectId) return false;
  return batches.some((b) => b.projectId === projectId);
}

function BatchProgressCard({ batch }: { batch: UploadBatch }) {
  const t = useTranslations('InterviewsV2');
  const { dismissBatch } = useInterviewUpload();

  const counts = useMemo(() => {
    const c: Record<Group, number> = {
      processing: 0,
      indexing: 0,
      done: 0,
      error: 0,
      duplicate: 0,
    };
    for (const f of batch.files) c[groupOf(f.status)] += 1;
    return c;
  }, [batch.files]);

  const total = batch.files.length;
  // Resolved = every terminal file (done + duplicate + error). Drives the bar.
  const resolved = counts.done + counts.duplicate + counts.error;
  const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
  const hasError = counts.error > 0;
  const complete = batch.done;
  const cleanComplete = complete && !hasError;

  // Auto-dismiss a clean completion after a short delay so the slot returns to
  // the dropzone. Failures stick until manually dismissed.
  useEffect(() => {
    if (!cleanComplete) return;
    const id = setTimeout(() => dismissBatch(batch.id), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [cleanComplete, batch.id, dismissBatch]);

  const failedNames = useMemo(
    () => batch.files.filter((f) => f.status === 'error').map((f) => f.name),
    [batch.files],
  );

  // Compact stage chips — only non-zero groups, reusing the per-file status
  // labels so no new copy is needed for the shared states.
  const chips: { key: Group; label: string; cls: string }[] = [];
  if (counts.processing > 0) {
    chips.push({
      key: 'processing',
      label: `${t('statusConverting')} ${counts.processing}`,
      cls: 'text-amore',
    });
  }
  if (counts.indexing > 0) {
    chips.push({
      key: 'indexing',
      label: `${t('statusIndexing')} ${counts.indexing}`,
      cls: 'text-amore',
    });
  }
  if (counts.done > 0) {
    chips.push({
      key: 'done',
      label: `${t('statusDone')} ${counts.done}`,
      cls: 'text-mute',
    });
  }
  if (counts.duplicate > 0) {
    chips.push({
      key: 'duplicate',
      label: `${t('statusDuplicate')} ${counts.duplicate}`,
      cls: 'text-mute-soft',
    });
  }
  if (counts.error > 0) {
    chips.push({
      key: 'error',
      label: `${t('statusError')} ${counts.error}`,
      cls: 'text-warning',
    });
  }

  return (
    <div className="w-full rounded-sm border border-line bg-paper px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!complete && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amore" />
            )}
            <span className="truncate text-md font-semibold text-ink-2">
              {t('upload')}
            </span>
            {batch.restored && (
              <span className="shrink-0 text-xs text-mute-soft">
                · {t('uploadArtifactRestoredNote')}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-mute-soft tabular-nums">
            {cleanComplete ? t('uploadArtifactComplete') : `${resolved}/${total}`}
          </div>
        </div>
        <IconButton
          variant="ghost"
          size="compact"
          className="shrink-0 text-lg leading-none"
          aria-label={t('close')}
          onClick={() => dismissBatch(batch.id)}
        >
          ×
        </IconButton>
      </div>

      {/* Aggregate progress bar — fill turns warning-tinted if any file failed
          so a partial failure reads at a glance. Radius/colour via tokens. */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
        <div
          className={`h-full rounded-full transition-[width] duration-[var(--dur-fast)] ${
            hasError ? 'bg-warning' : 'bg-amore'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {chips.map((c) => (
            <span
              key={c.key}
              className={`text-xs font-semibold uppercase tracking-[0.14em] tabular-nums ${c.cls}`}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {complete && failedNames.length > 0 && (
        <div className="mt-2 border-t border-line-soft pt-2">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-warning">
            {t('uploadArtifactFailedTitle')}
          </div>
          <ul className="mt-1 space-y-0.5">
            {failedNames.map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="truncate text-xs text-mute"
                title={name}
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Inline progress for one project — rendered in the control-board slot where
// the dropzone normally sits. Returns null when the project has no batches (the
// caller then shows its dropzone instead).
export function InlineUploadProgress({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const { batches } = useInterviewUpload();
  const mine = useMemo(
    () => batches.filter((b) => b.projectId === projectId),
    [batches, projectId],
  );
  if (mine.length === 0) return null;
  return (
    <div className={`w-full space-y-2${className ? ` ${className}` : ''}`}>
      {mine.map((b) => (
        <BatchProgressCard key={b.id} batch={b} />
      ))}
    </div>
  );
}
