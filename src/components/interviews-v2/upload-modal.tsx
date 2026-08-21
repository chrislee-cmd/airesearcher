'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast-provider';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { CloseButton } from '@/components/ui/close-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
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
//
// VISUAL — CD 계약 B (upload-modal-BUILD-SPEC §1·2·4 · CLOSE-BUTTON-AUDIT.dc.html
// §2 after). Modal `bare` 로 프레임을 이 컴포넌트가 통째로 소유: border 3 · radius
// 18(rounded-modal) · shadow-memphis-2xl(8px8px0 blur0) · rose 밴드 헤더(§6 결정,
// 인터뷰 전용) · 파일 행 = 타입타일 24 + 이름 + 용량 mono + row-remove(계약 A) ·
// 목록 헤더 총 개수·총량(amber 임계) · 4행 초과 접기 · 푸터 4단 버튼 + 좌측 안내.
// ✕ 는 전부 <CloseButton>(계약 A #1292) 호출 — 재구현 없음. 진행 배너는 이 PR
// 범위 밖(#678 소유). 안 그린 상태(드래그오버 강조·파일단위 진행률·초과 거부·
// 중복·미지원·되돌리기·트랜지션)는 발명하지 않고 기존 동작 유지.

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.doc,.docx,.pdf,audio/*,video/*,.zip';
// 총량 amber 임계 = 25MB 의 80% (BUILD-SPEC §6 · CD 제안). 근접 시 목록 헤더
// 총량이 amber 로 전환해 업로드를 누르기 전에 제한을 알린다.
const AMBER_THRESHOLD = 0.8 * MAX_BYTES;
// 목록 접기 임계 행 수 (BUILD-SPEC §6 · CD 제안 4). 초과분은 `＋N개 더` 로 접되
// 배치 업로드에는 전부 포함된다. 펼치기 인터랙션은 CD 미설계(§5) — 발명 안 함.
const FOLD_ROWS = 4;
// FileDropZone 라벨/타이틀과 동일한 Outfit 스택 (헤더 타이틀·드롭존 타이틀).
const OUTFIT_STACK = 'var(--font-outfit), var(--font-sans)';

// 파일 용량 표기 — MB 1 소수점(예: 24.1MB), 1MB 미만은 KB 반올림. 목록 헤더
// 총량 + 행별 용량에 공용.
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))}KB`;
}

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

  const totalBytes = useMemo(
    () => staged.reduce((sum, f) => sum + f.size, 0),
    [staged],
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

  // Footer buttons depend on where we are in the wizard. Secondary = ghost
  // (thin line + shadow-sm-faint, §D1) / primary = ink + shadow (§D1). CD 계약 B
  // §6 4단 규격은 Button 프리미티브가 소유 — 여기선 variant 만 고른다.
  const footerButtons =
    step === 'files' && !preset ? (
      <>
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
      </>
    ) : step === 'project' ? (
      <>
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
      </>
    ) : (
      // files step with a preset project → upload directly (Step 2 skipped).
      <>
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
      </>
    );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      bare
      dismissOnBackdrop={!submitting}
      dsPrimitive="UploadModal"
      labelledBy="upload-modal-title"
    >
      {/* Frame — §1.1: border 3 · radius 18 · shadow-2xl 8px8px0 blur0. */}
      <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-modal border-[3px] border-ink bg-paper shadow-memphis-2xl">
        {/* Header — §1.2: rose 밴드 + border-b 2 · Outfit 800/17 · 총량 pill +
            dialog-close(계약 A). */}
        <header className="flex shrink-0 items-center gap-2.5 border-b-2 border-ink bg-rose px-[18px] py-3.5">
          <h2
            id="upload-modal-title"
            className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-[-0.02em] text-ink"
            style={{ fontFamily: OUTFIT_STACK }}
          >
            {t('uploadTitle')}
          </h2>
          {staged.length > 0 && (
            <span className="shrink-0 rounded-chip border-[1.5px] border-ink bg-paper px-2 py-0.5 font-mono text-xs-soft font-extrabold text-ink">
              {t('uploadHeaderPill', { count: staged.length })}
            </span>
          )}
          <CloseButton
            variant="dialog-close"
            aria-label={t('close')}
            onClick={handleClose}
            disabled={submitting}
          />
        </header>

        {/* Body — §2: surface-canvas 바탕, min-h-0 로 본문만 스크롤. */}
        <div className="min-h-0 flex-1 overflow-auto bg-surface-canvas px-[18px] py-[18px]">
          {step === 'files' ? (
            <div className="flex flex-col gap-3.5">
              {/* Dropzone — §1.3: 2.5px 점선 line-empty + 업로드 아이콘 타일
                  (44·border3·shadow-md). FileDropZone bare 로 프레임을 여기서
                  소유(네이티브 input·drag 는 프리미티브). */}
              <FileDropZone
                bare
                multiple
                accept={ACCEPT}
                maxSizeBytes={MAX_BYTES}
                onFiles={handleFiles}
                className="gap-[9px] rounded-panel border-[2.5px] border-dashed border-line-empty bg-paper px-4 py-[26px]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-panel border-[3px] border-ink bg-paper shadow-memphis-md">
                  <DuotoneIcon name="upload" size={22} />
                </span>
                <span
                  className="text-xl font-extrabold text-ink"
                  style={{ fontFamily: OUTFIT_STACK }}
                >
                  {t('emptyDropTitle')}
                </span>
                <span className="font-mono text-xs tracking-[0.04em] text-mute-soft">
                  {t('uploadDropFormats')}
                </span>
              </FileDropZone>

              {/* File list — §1.4: border strong 2 · radius panel · shadow-md-faint
                  · 구분선 hair ink/8. §1.5: 목록 헤더 총 개수·총량. */}
              {staged.length > 0 && (
                <div className="overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-memphis-md-faint">
                  <div className="flex items-center gap-2 border-b border-ink/10 bg-paper-soft px-[13px] py-[7px]">
                    <span className="flex-1 font-mono text-xs font-extrabold uppercase tracking-[0.1em] text-mute">
                      {t('uploadListHeader', { count: staged.length })}
                    </span>
                    <span
                      className={`font-mono text-xs font-bold ${
                        totalBytes >= AMBER_THRESHOLD
                          ? 'text-amber'
                          : 'text-mute-soft'
                      }`}
                    >
                      {formatBytes(totalBytes)}
                    </span>
                  </div>
                  {/* File row — §2: [타입타일 24] [이름 ellipsis] [용량 mono]
                      [row-remove 28]. hover 시 행 배경 surface-canvas. */}
                  {staged.slice(0, FOLD_ROWS).map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2.5 border-b border-ink/8 px-[13px] py-2.5 transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-canvas motion-reduce:transition-none"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-nav border-[1.5px] border-ink bg-rose">
                        <DuotoneIcon
                          name="document"
                          size={13}
                          fill="var(--color-paper)"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-md text-ink">
                        {f.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-mute-soft">
                        {formatBytes(f.size)}
                      </span>
                      <CloseButton
                        variant="row-remove"
                        aria-label={t('uploadRemoveFile')}
                        onClick={() => removeStaged(i)}
                      />
                    </div>
                  ))}
                  {/* Fold — §2: 4행 초과분은 접되 배치엔 전부 포함. CD .dc.html
                      대로 정적 표시(펼치기 인터랙션 CD 미설계 → 발명 안 함). */}
                  {staged.length > FOLD_ROWS && (
                    <div className="bg-surface-canvas px-[13px] py-2 font-mono text-xs font-bold text-mute-soft">
                      {t('uploadFoldMore', { count: staged.length - FOLD_ROWS })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Step 2 — project setup gate. 폼 컨트롤은 프리미티브 그대로.
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

        {/* Footer — §1.6: border-t 2 · 좌측 후속 안내 mono · 4단 버튼. */}
        <footer className="flex shrink-0 items-center gap-2.5 border-t-2 border-ink bg-paper px-[18px] py-3.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs-soft font-bold text-mute-soft">
            {t('uploadFooterNote')}
          </span>
          {footerButtons}
        </footer>
      </div>
    </Modal>
  );
}
