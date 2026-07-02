'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  useInterviewV2Upload,
  type UploadFileStatus,
} from '@/hooks/use-interview-v2-upload';

// Interview V2 — batch upload modal. Drops files into useInterviewV2Upload
// which converts each to markdown, then indexes them under the current
// project. Per-file status pills mirror the pipeline stages; on success the
// caller refetches the project's document list via onUploaded.

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.doc,.docx,.pdf,audio/*,video/*';

function UploadStatusPill({ status }: { status: UploadFileStatus }) {
  const t = useTranslations('InterviewsV2');
  const map: Record<UploadFileStatus, { key: string; cls: string }> = {
    converting: { key: 'statusConverting', cls: 'text-amore' },
    indexing: { key: 'statusIndexing', cls: 'text-amore' },
    done: { key: 'statusDone', cls: 'text-mute' },
    error: { key: 'statusError', cls: 'text-warning' },
  };
  const p = map[status];
  return (
    <span
      className={`shrink-0 text-xs font-semibold uppercase tracking-[0.18em] ${p.cls}`}
    >
      {t(p.key)}
    </span>
  );
}

export function UploadModal({
  open,
  onClose,
  projectId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onUploaded: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { items, busy, uploadMany, reset } = useInterviewV2Upload(projectId);

  const handleFiles = (files: File[]) => {
    void uploadMany(files).then((changed) => {
      if (changed) onUploaded();
    });
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('uploadTitle')}
      size="md"
      dismissOnBackdrop={!busy}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            {t('close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FileDropZone
          multiple
          accept={ACCEPT}
          maxSizeBytes={MAX_BYTES}
          disabled={busy}
          onFiles={handleFiles}
          className="px-6 py-10"
          label={t('uploadDropLabel')}
          helperText={t('uploadDropHelper')}
        />

        {items.length > 0 && (
          <ul className="rounded-sm border border-line bg-paper">
            {items.map((it, i) => (
              <li
                key={`${it.name}-${i}`}
                className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate text-md text-ink-2">
                  {it.name}
                </span>
                <UploadStatusPill status={it.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
