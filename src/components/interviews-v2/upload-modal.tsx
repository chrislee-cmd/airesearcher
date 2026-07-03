'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import {
  useInterviewV2Upload,
  type UploadFileStatus,
} from '@/hooks/use-interview-v2-upload';

// Interview V2 — batch upload modal, now a 2-step wizard that gates every
// upload behind a project so the indexed rows always land with a
// interview_documents.project_id and show up in the V2 fullview.
//
//   Step 1 (files)   — pick the files to upload (staged locally).
//   Step 2 (project) — REQUIRED unless the caller already knows the
//                      project (project-detail passes projectId → skip).
//                      Choose an existing V2 project or create one inline.
//   → "업로드"        — converts each file to markdown, then indexes the
//                      batch under the resolved project_id.
//
// Entry points:
//   * project-detail  → projectId preset → Step 2 skipped, upload direct.
//   * project-list     → no projectId    → Step 2 forces project setup, and
//                      onUploaded(id) lets the caller jump into that project
//                      so the freshly indexed files are visible immediately.

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

type Step = 'files' | 'project';
type ProjectMode = 'pick' | 'create';

export function UploadModal({
  open,
  onClose,
  projectId,
  onUploaded,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  // Preset project (project-detail entry) → Step 2 is skipped. Omitted / null
  // (project-list entry) → Step 2 is a required gate before upload.
  projectId?: string | null;
  // Internal mode (default): the modal runs the upload itself, shows per-file
  // status pills, and calls onUploaded(id) when the batch finishes.
  onUploaded?: (projectId: string) => void;
  // Delegate mode: when provided, the modal only resolves the project
  // (pick/create) then hands (files, projectId) back and closes immediately —
  // it does NOT run the upload. The caller owns the upload lifecycle (e.g. the
  // widget card renders its own progress bar + completion footer). Takes
  // precedence over onUploaded.
  onSubmit?: (files: File[], projectId: string) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { items, busy, uploadMany, reset } = useInterviewV2Upload();
  const { projects, create } = useInterviewV2Projects();

  const preset = projectId ?? null;

  const [staged, setStaged] = useState<File[]>([]);
  const [step, setStep] = useState<Step>('files');
  const [mode, setMode] = useState<ProjectMode>('pick');
  const [pickId, setPickId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createErr, setCreateErr] = useState(false);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const resetAll = () => {
    reset();
    setStaged([]);
    setStep('files');
    setMode(projects.length === 0 ? 'create' : 'pick');
    setPickId('');
    setNewName('');
    setNewDesc('');
    setCreateErr(false);
  };

  const handleClose = () => {
    if (busy) return;
    resetAll();
    onClose();
  };

  const handleFiles = (files: File[]) => {
    setStaged((prev) => [...prev, ...files]);
  };

  const removeStaged = (index: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  };

  // Resolve the project (preset / picked / newly-created), then run the
  // batch. Returns nothing — status is reflected via items/busy.
  const runUpload = async () => {
    let pid = preset;
    if (!pid) {
      if (mode === 'create') {
        const name = newName.trim();
        if (!name) return;
        const created = await create(name, newDesc.trim() || undefined);
        if (!created) {
          setCreateErr(true);
          return;
        }
        pid = created.id;
      } else {
        pid = pickId || null;
      }
    }
    if (!pid) return;

    // Delegate mode — hand the batch to the caller and close. The caller
    // owns the upload + progress UI (widget card). Snapshot files first
    // since resetAll() clears staged.
    if (onSubmit) {
      const files = staged;
      resetAll();
      onClose();
      onSubmit(files, pid);
      return;
    }

    const changed = await uploadMany(staged, pid);
    if (changed) onUploaded?.(pid);
  };

  const canUpload =
    staged.length > 0 &&
    (preset
      ? true
      : mode === 'create'
        ? newName.trim().length > 0
        : pickId.length > 0);

  const showResults = items.length > 0;

  // Footer buttons depend on where we are in the wizard.
  const footer = showResults ? (
    <div className="flex justify-end">
      <Button variant="ghost" onClick={handleClose} disabled={busy}>
        {t('close')}
      </Button>
    </div>
  ) : step === 'files' && !preset ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={handleClose}>
        {t('close')}
      </Button>
      <Button
        variant="primary"
        onClick={() => setStep('project')}
        disabled={staged.length === 0}
      >
        {t('uploadNext')}
      </Button>
    </div>
  ) : step === 'project' ? (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={() => setStep('files')}>
        ← {t('back')}
      </Button>
      <Button variant="primary" onClick={() => void runUpload()} disabled={!canUpload}>
        {t('uploadAction')}
      </Button>
    </div>
  ) : (
    // files step with a preset project → upload directly (Step 2 skipped).
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={handleClose}>
        {t('close')}
      </Button>
      <Button variant="primary" onClick={() => void runUpload()} disabled={!canUpload}>
        {t('uploadAction')}
      </Button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('uploadTitle')}
      size="md"
      dismissOnBackdrop={!busy}
      footer={footer}
    >
      <div className="space-y-4">
        {showResults ? (
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
        ) : step === 'files' ? (
          <>
            <FileDropZone
              multiple
              accept={ACCEPT}
              maxSizeBytes={MAX_BYTES}
              onFiles={handleFiles}
              className="px-6 py-10"
              label={t('uploadDropLabel')}
              helperText={t('uploadDropHelper')}
            />

            {staged.length > 0 && (
              <ul className="rounded-sm border border-line bg-paper">
                {staged.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-md text-ink-2">
                      {f.name}
                    </span>
                    <IconButton
                      variant="ghost-danger"
                      size="compact"
                      className="text-lg leading-none"
                      aria-label={t('uploadRemoveFile')}
                      onClick={() => removeStaged(i)}
                    >
                      ×
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          // Step 2 — project setup gate.
          <div className="space-y-4">
            <p className="text-sm text-mute-soft">{t('uploadProjectGateHint')}</p>

            {mode === 'pick' ? (
              <div className="space-y-3">
                <Select
                  label={t('uploadSelectProjectLabel')}
                  placeholder={t('uploadSelectProjectPlaceholder')}
                  options={projectOptions}
                  value={pickId}
                  onChange={(e) => setPickId(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMode('create');
                    setCreateErr(false);
                  }}
                >
                  + {t('newProject')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label={t('projectName')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('projectNamePlaceholder')}
                  maxLength={200}
                  autoFocus
                />
                <Textarea
                  label={t('projectDescription')}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={t('projectDescriptionPlaceholder')}
                  maxLength={2000}
                  rows={3}
                />
                {createErr && (
                  <p className="text-sm text-warning">{t('createFailed')}</p>
                )}
                {projects.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMode('pick');
                      setCreateErr(false);
                    }}
                  >
                    ← {t('uploadPickToggle')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
