'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast-provider';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useInterviewUpload } from '@/components/interview-upload-provider';

// Interview V2 — batch upload modal. Reduced to a file/project SELECTION entry
// (pr-interview-upload-background-progress-artifact): it stages files, resolves
// the target project (Step 2), then hands the batch to the app-level
// InterviewUploadProvider and closes IMMEDIATELY. The convert/index pipeline
// runs in the provider (survives modal close + navigation) and progress shows
// in the docked <InterviewUploadArtifact> — the modal no longer owns per-file
// status and no longer blocks the app while a batch runs.
//
//   Step 1 (files)   — pick the files to upload (staged locally).
//   Step 2 (project) — REQUIRED unless the caller already knows the project
//                      (project-detail passes projectId → skip). Choose an
//                      existing V2 project or create one inline.
//   → "업로드"        — startUpload(batch) in the provider, close, and (for
//                      project-less entries) jump into the chosen project so
//                      the freshly indexing files are visible there + in the
//                      artifact.
//
// Entry points:
//   * project-detail  → projectId preset → Step 2 skipped, upload direct.
//   * project-list     → no projectId    → Step 2 forces project setup, and
//                      onUploaded(id) lets the caller jump into that project.

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.doc,.docx,.pdf,audio/*,video/*';

type Step = 'files' | 'project';
type ProjectMode = 'pick' | 'create';

export function UploadModal({
  open,
  onClose,
  projectId,
  onUploaded,
  initialFiles,
  existingFilenames,
}: {
  open: boolean;
  onClose: () => void;
  // Preset project (project-detail entry) → Step 2 is skipped. Omitted / null
  // (project-list entry) → Step 2 is a required gate before upload.
  projectId?: string | null;
  // Filenames already in the preset project — feeds the client-side duplicate
  // pre-filter. Optional: the server's content-hash dedupe is the real
  // guarantee, so callers without a loaded document list can omit it.
  existingFilenames?: string[];
  // Files handed in from an inline FileDropZone outside the modal (the widget
  // card control). Pre-staged when the modal opens.
  initialFiles?: File[];
  // Called once the background upload has STARTED for the resolved project.
  // Lets project-less entries (project-list / widget idle) jump into that
  // project so the indexing files are visible there and in the artifact.
  onUploaded?: (projectId: string) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { push } = useToast();
  const { projects, create, isLoading } = useInterviewV2Projects();
  const { startUpload } = useInterviewUpload();

  const preset = projectId ?? null;

  const [staged, setStaged] = useState<File[]>([]);
  const [step, setStep] = useState<Step>('files');
  // null until projects have loaded — the effect below then defaults to
  // 'create' when there are no projects or 'pick' when projects already exist.
  const [mode, setMode] = useState<ProjectMode | null>(null);
  const [pickId, setPickId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createErr, setCreateErr] = useState(false);
  // Guards the (async) inline project-create so a double-click can't create
  // two projects / start two batches. The upload itself is fire-and-forget.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === null && !isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect async projects load
      setMode(projects.length > 0 ? 'pick' : 'create');
    }
  }, [mode, isLoading, projects.length]);

  // Pre-stage files handed in from the card's inline dropzone when the modal
  // opens. Only seeds when the stage is still empty so re-renders don't re-add
  // them; resetAll() on close clears the stage for the next open.
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed staged files on open transition
      setStaged((prev) => (prev.length === 0 ? [...initialFiles] : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open transition
  }, [open]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const resetAll = () => {
    setStaged([]);
    setStep('files');
    setMode(null);
    setPickId('');
    setNewName('');
    setNewDesc('');
    setCreateErr(false);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    resetAll();
    onClose();
  };

  const handleFiles = (files: File[]) => {
    setStaged((prev) => [...prev, ...files]);
  };

  const removeStaged = (index: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  };

  // Resolve the project (preset / picked / newly-created), hand the batch to
  // the background provider, then close. The upload runs in the provider and
  // its progress shows in the docked artifact — the modal does NOT wait.
  const runUpload = async () => {
    if (submitting || staged.length === 0) return;
    let pid = preset;
    let name: string | null =
      projects.find((p) => p.id === preset)?.name ?? null;
    if (!pid) {
      if (mode === 'create') {
        const trimmed = newName.trim();
        if (!trimmed) return;
        setSubmitting(true);
        const { project: created, error } = await create(
          trimmed,
          newDesc.trim() || undefined,
        );
        if (!created) {
          setSubmitting(false);
          setCreateErr(true);
          push(error ? `${t('createFailed')}: ${error}` : t('createFailed'), {
            tone: 'warn',
          });
          return;
        }
        pid = created.id;
        name = created.name;
      } else {
        pid = pickId || null;
        name = projects.find((p) => p.id === pickId)?.name ?? null;
      }
    }
    if (!pid) return;

    const files = staged;
    const targetId = pid;
    startUpload({
      files,
      projectId: targetId,
      projectName: name,
      existingFilenames: existingFilenames ?? [],
    });
    resetAll();
    onClose();
    onUploaded?.(targetId);
  };

  const canUpload =
    !submitting &&
    staged.length > 0 &&
    (preset
      ? true
      : mode === 'create'
        ? newName.trim().length > 0
        : pickId.length > 0);

  // Footer buttons depend on where we are in the wizard.
  const footer =
    step === 'files' && !preset ? (
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
        <Button
          variant="primary"
          onClick={() => void runUpload()}
          disabled={!canUpload}
        >
          {t('uploadAction')}
        </Button>
      </div>
    ) : (
      // files step with a preset project → upload directly (Step 2 skipped).
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={handleClose}>
          {t('close')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void runUpload()}
          disabled={!canUpload}
        >
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
      dismissOnBackdrop={!submitting}
      footer={footer}
    >
      <div className="space-y-4">
        {step === 'files' ? (
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
            <p className="text-sm text-mute-soft">
              {t('uploadProjectGateHint')}
            </p>

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
