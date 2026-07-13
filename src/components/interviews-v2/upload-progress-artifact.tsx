'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';
import {
  useInterviewUpload,
  type UploadBatch,
  type UploadFileStatus,
} from '@/components/interview-upload-provider';

// Interview V2 — persistent, non-modal upload progress surface
// (pr-interview-upload-background-progress-artifact).
//
// Mounted once in the (app) layout, this docks bottom-right and renders the
// background upload provider's live batches: N/M, stage counts, an aggregate
// progress bar, and per-file failures. It NEVER blocks the app — the wrapper is
// pointer-events-none so only the cards themselves are interactive, and it's a
// small docked panel (not a modal/overlay). Progress survives navigation (the
// provider lives in the layout) and a refresh re-surfaces still-indexing
// batches from the DB (see InterviewUploadProvider restore path).
//
// Completion: a clean batch (all done, no error) auto-dismisses after a short
// delay; a batch with any failure stays until the user dismisses it, so the
// failed filenames don't vanish before they're seen (#1007 parity).

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

function BatchCard({ batch }: { batch: UploadBatch }) {
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

  // Auto-dismiss a clean completion after a short delay so the artifact
  // doesn't pile up. Failures stick until manually dismissed.
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

  const title =
    batch.projectName && batch.projectName.trim().length > 0
      ? batch.projectName
      : t('uploadArtifactTitle');

  return (
    <div className="pointer-events-auto w-[320px] rounded-sm border border-line bg-paper px-4 py-3 shadow-memphis-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!complete && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amore" />
            )}
            <span className="truncate text-md font-semibold text-ink-2">
              {title}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-mute-soft tabular-nums">
            {cleanComplete
              ? t('uploadArtifactComplete')
              : `${resolved}/${total}`}
            {batch.restored && (
              <span className="ml-1.5 text-mute-soft">
                · {t('uploadArtifactRestoredNote')}
              </span>
            )}
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

export function InterviewUploadArtifact() {
  const { batches } = useInterviewUpload();
  if (batches.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex flex-col gap-2">
      {batches.map((b) => (
        <BatchCard key={b.id} batch={b} />
      ))}
    </div>
  );
}
