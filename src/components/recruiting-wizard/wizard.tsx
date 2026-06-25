'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parsePartialJson } from 'ai';
import { track } from '@/components/mixpanel-provider';
import { useRequireAuth } from '@/components/auth-provider';
import { useGenerationJobs } from '@/components/generation-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { MochiLoader } from '@/components/ui/mochi-loader';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey } from '@/lib/survey-schema';
import {
  CriteriaEditor,
  CriteriaPreview,
  SurveyEditor,
  SurveyPreview,
} from './views';

type Criterion = RecruitingBrief['criteria'][number];

type EditableBrief = {
  summary: string;
  criteria: Criterion[];
  // Schedule is extracted server-side and forwarded to the survey-gen
  // prompt for context, but it's intentionally not edited in the wizard.
  schedule: RecruitingBrief['schedule'];
};

type Phase = 'idle' | 'generating' | 'review' | 'approved';
type CardError = string | null;

type GoogleStatus = {
  connected: boolean;
  email: string | null;
  hasDrive: boolean;
};

type PublishedForm = {
  formId: string;
  responderUri: string;
  editUri: string;
};

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';
const ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;
const MAX_FILES = 10;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function RecruitingWizard() {
  const requireAuth = useRequireAuth();
  const jobs = useGenerationJobs();
  const workspace = useWorkspace();

  // ── Card 1: criteria ────────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState('');
  const [rejected, setRejected] = useState<string[]>([]);
  const [criteriaPhase, setCriteriaPhase] = useState<Phase>('idle');
  const [criteriaError, setCriteriaError] = useState<CardError>(null);
  const [partialBrief, setPartialBrief] =
    useState<Partial<RecruitingBrief> | null>(null);
  const [editedBrief, setEditedBrief] = useState<EditableBrief | null>(null);

  // ── Card 2: survey ──────────────────────────────────────────────────
  const [surveyPhase, setSurveyPhase] = useState<Phase>('idle');
  const [surveyError, setSurveyError] = useState<CardError>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);

  // ── Card 3: Google Form ─────────────────────────────────────────────
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (!g || g === 'connected') return null;
    return g;
  });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishedForm | null>(null);

  // ── Modal state ─────────────────────────────────────────────────────
  type ModalState =
    | { open: false }
    | { open: true; card: 'criteria' | 'survey'; mode: 'preview' | 'editor' };
  const [modal, setModal] = useState<ModalState>({ open: false });

  // ── Effects ─────────────────────────────────────────────────────────
  // Google connection status — needed for Card 3 affordance.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/recruiting/google/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setGoogle({
            connected: !!j.connected,
            email: j.email ?? null,
            hasDrive: !!j.hasDrive,
          });
        }
      })
      .catch(() => {});
    // Strip `?google=...` so the OAuth callback parameter doesn't linger
    // in the URL bar after we surface the error to the user.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('google')) {
        params.delete('google');
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : '');
        window.history.replaceState(null, '', next);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Once jobs() reports the extract is done, seed the editable brief.
  // We track the source result identity to avoid re-seeding after user
  // edits.
  const job = jobs.get('recruiting');
  const jobRunning = job.status === 'running';
  const jobResult =
    job.status === 'done' ? (job.result as RecruitingBrief | null) : null;
  const [seededFor, setSeededFor] = useState<RecruitingBrief | null>(null);
  if (jobResult && jobResult !== seededFor) {
    setSeededFor(jobResult);
    setEditedBrief({
      summary: jobResult.summary ?? '',
      criteria: jobResult.criteria.map((c) => ({ ...c })),
      schedule: jobResult.schedule.map((p) => ({ ...p })),
    });
    setCriteriaPhase('review');
  }

  // ── File handling ───────────────────────────────────────────────────
  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    const rejectedNames: string[] = [];
    for (const f of Array.from(incoming)) {
      if (ACCEPT_RE.test(f.name)) accepted.push(f);
      else rejectedNames.push(f.name);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => `${p.name}::${p.size}`));
      const next = [...prev];
      for (const f of accepted) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key) && next.length < MAX_FILES) {
          next.push(f);
          seen.add(key);
        }
      }
      return next;
    });
    setRejected(rejectedNames);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Card 1 actions ──────────────────────────────────────────────────
  function startExtract() {
    requireAuth(() => void doExtract());
  }

  async function doExtract() {
    if (files.length === 0 && !pasted.trim()) return;
    track('recruiting_extract_click', {
      feature: 'recruiting',
      file_count: files.length,
      pasted_chars: pasted.length,
    });
    const submittedFiles = files;
    const submittedPaste = pasted;

    setCriteriaError(null);
    setPartialBrief(null);
    setEditedBrief(null);
    setSeededFor(null);
    setSurveyPhase('idle');
    setSurvey(null);
    setSurveyError(null);
    setPublished(null);
    setPublishError(null);
    setCriteriaPhase('generating');

    await jobs.start<RecruitingBrief>('recruiting', {
      input: { count: submittedFiles.length },
      run: async () => {
        const fd = new FormData();
        for (const f of submittedFiles) fd.append('files', f);
        if (submittedPaste.trim()) fd.append('pasted', submittedPaste);

        const res = await fetch('/api/recruiting/extract', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `extract_failed: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = await parsePartialJson(buffer);
          if (parsed.value && typeof parsed.value === 'object') {
            setPartialBrief(parsed.value as Partial<RecruitingBrief>);
          }
        }

        const finalParsed = JSON.parse(buffer) as RecruitingBrief;
        setPartialBrief(finalParsed);
        track('recruiting_extract_success', { feature: 'recruiting' });
        return finalParsed;
      },
    });
  }

  // Surface job-level error into the card without an effect: track the
  // last error string we already absorbed and only react when it
  // changes. Mirrors the `seededFor` pattern above.
  const currentJobError =
    job.status === 'error' ? job.error ?? 'extract_failed' : null;
  const [absorbedJobError, setAbsorbedJobError] = useState<string | null>(null);
  if (currentJobError !== absorbedJobError) {
    setAbsorbedJobError(currentJobError);
    if (currentJobError) {
      setCriteriaPhase('idle');
      setCriteriaError(currentJobError);
    }
  }

  function approveCriteria() {
    if (!editedBrief) return;
    setCriteriaPhase('approved');
    // Trigger Card 2 generation automatically.
    void doGenerateSurvey(editedBrief);
  }

  function restartCriteria() {
    setCriteriaPhase('idle');
    setPartialBrief(null);
    setEditedBrief(null);
    setSeededFor(null);
    setCriteriaError(null);
    setSurveyPhase('idle');
    setSurvey(null);
    setSurveyError(null);
    setPublished(null);
    setPublishError(null);
  }

  // ── Card 2 actions ──────────────────────────────────────────────────
  // Track the in-flight survey-stream so a "재생성" click cancels the
  // previous reader before starting a new one.
  const surveyAbortRef = useRef<AbortController | null>(null);

  async function doGenerateSurvey(brief: EditableBrief) {
    surveyAbortRef.current?.abort();
    const ctrl = new AbortController();
    surveyAbortRef.current = ctrl;

    setSurveyPhase('generating');
    setSurveyError(null);
    setSurvey(null);
    setPublished(null);
    setPublishError(null);
    track('recruiting_survey_generate_click', {
      feature: 'recruiting_survey',
    });

    try {
      const briefForApi: RecruitingBrief = {
        summary: brief.summary,
        criteria: brief.criteria,
        schedule: brief.schedule,
      };
      const res = await fetch('/api/recruiting/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: briefForApi }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `survey_failed: ${res.statusText}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      if (ctrl.signal.aborted) return;
      const finalSurvey = JSON.parse(buffer) as Survey;
      setSurvey(finalSurvey);
      setSurveyPhase('review');
      track('recruiting_survey_generate_success', {
        feature: 'recruiting_survey',
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setSurveyError(e instanceof Error ? e.message : 'survey_failed');
      setSurveyPhase('idle');
    } finally {
      if (surveyAbortRef.current === ctrl) surveyAbortRef.current = null;
    }
  }

  function approveSurvey() {
    if (!survey) return;
    setSurveyPhase('approved');
  }

  function regenerateSurvey() {
    if (!editedBrief) return;
    void doGenerateSurvey(editedBrief);
  }

  // ── Card 3 actions ──────────────────────────────────────────────────
  async function publishToGoogle() {
    if (!survey) return;
    setPublishing(true);
    setPublishError(null);
    try {
      // Cap the round-trip at 45s — comfortably above the worst-case
      // Google Forms create + batchUpdate + Drive permission round-trip
      // we've measured, but well under Vercel's maxDuration=60 so the
      // user gets a clear error instead of a button stuck in "발행중"
      // when something upstream silently hangs.
      const res = await fetch('/api/recruiting/google/forms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ survey }),
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error ?? `publish_failed: ${res.statusText}`);
      }
      const pub: PublishedForm = {
        formId: j.formId ?? j.form_id,
        responderUri: j.responderUri,
        editUri: j.editUri,
      };
      setPublished(pub);
      // Refresh the bento-bottom outputs row without waiting for its
      // 30 s poll tick.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('recruiting:published'));
      }
      track('recruiting_publish_success', { feature: 'recruiting_publish' });
      // Register the published form as a workspace artifact.
      if (pub.formId) {
        const md = [
          `# ${survey.title || 'Recruiting form'}`,
          '',
          `- 응답 링크: ${pub.responderUri ?? ''}`,
          `- 편집 링크: ${pub.editUri ?? ''}`,
          '',
          ...survey.sections.flatMap((s) => [
            `## ${s.title || ''}`,
            ...s.questions.map((q, i) => `${i + 1}. ${q.title}`),
            '',
          ]),
        ].join('\n');
        let activeProjectId: string | null = null;
        try {
          const raw = window.localStorage.getItem('active_project:v1');
          if (raw) {
            const parsed = JSON.parse(raw) as { id?: string } | null;
            activeProjectId = parsed?.id ?? null;
          }
        } catch {}
        workspace.addArtifact({
          id: `recruiting_${pub.formId}`,
          featureKey: 'recruiting',
          title: `${survey.title || 'recruiting'}.md`,
          content: md,
          dbFeature: 'recruiting',
          dbId: pub.formId,
          projectId: activeProjectId,
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        setPublishError('publish_timeout: 45초 내에 응답이 없습니다. 다시 시도해 주세요.');
      } else {
        setPublishError(e instanceof Error ? e.message : 'publish_failed');
      }
    } finally {
      setPublishing(false);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────
  const partialCriteria: Criterion[] = editedBrief
    ? editedBrief.criteria
    : ((partialBrief?.criteria ?? []).filter(
        (c): c is Criterion =>
          typeof c?.category === 'string' &&
          typeof c?.label === 'string' &&
          typeof c?.detail === 'string' &&
          typeof c?.required === 'boolean',
      ) as Criterion[]);
  const canExtract =
    (files.length > 0 || pasted.trim().length > 0) && !jobRunning;
  const summaryForCard =
    editedBrief?.summary?.trim() || partialBrief?.summary?.trim() || '';

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* CARD 1 — 대상자 조건 */}
      <WizardCard
        index={1}
        title="대상자 조건"
        phase={criteriaPhase}
        accentColor="amore"
        collapseOnApprove
      >
        {criteriaPhase === 'idle' && (
          <CriteriaInputArea
            files={files}
            pasted={pasted}
            rejected={rejected}
            running={jobRunning}
            onPasteChange={setPasted}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onExtract={startExtract}
            canExtract={canExtract}
            error={criteriaError}
          />
        )}

        {criteriaPhase === 'generating' && (
          <GeneratingRow
            label={
              partialCriteria.length > 0
                ? `${partialCriteria.length}개 조건 추출 중…`
                : '조건 추출 중…'
            }
          />
        )}

        {(criteriaPhase === 'review' || criteriaPhase === 'approved') &&
          editedBrief && (
            <ReviewRow
              title={summaryForCard || '추출 완료'}
              meta={`${editedBrief.criteria.length}개 조건`}
              phase={criteriaPhase}
              onPreview={() =>
                setModal({ open: true, card: 'criteria', mode: 'preview' })
              }
              onEdit={() =>
                setModal({ open: true, card: 'criteria', mode: 'editor' })
              }
              onApprove={approveCriteria}
              onRestart={restartCriteria}
              restartLabel="처음부터 다시"
            />
          )}
      </WizardCard>

      {/* CARD 2 — 심사 설문. Card 1 승인 전에는 아예 렌더하지 않음 — 단계가
          진행되면서 카드가 하나씩 순차로 나타나도록. restartCriteria 가
          criteriaPhase 를 'idle' 로 되돌리면 자동으로 다시 사라짐. */}
      {criteriaPhase === 'approved' && (
        <WizardCard
          index={2}
          title="심사 설문"
          phase={surveyPhase}
          accentColor="amore"
          collapseOnApprove
        >
          {surveyPhase === 'idle' && (
            <GeneratingRow label="설문 생성 대기 중…" />
          )}

          {surveyPhase === 'generating' && (
            <GeneratingRow label="조건에 맞춘 설문 생성 중…" />
          )}

          {(surveyPhase === 'review' || surveyPhase === 'approved') && survey && (
            <ReviewRow
              title={survey.title || '설문 생성 완료'}
              meta={`${survey.sections.length}개 섹션 · ${survey.sections.reduce(
                (n, s) => n + s.questions.length,
                0,
              )}개 질문`}
              phase={surveyPhase}
              onPreview={() =>
                setModal({ open: true, card: 'survey', mode: 'preview' })
              }
              onEdit={() =>
                setModal({ open: true, card: 'survey', mode: 'editor' })
              }
              onApprove={approveSurvey}
              onRestart={regenerateSurvey}
              restartLabel="설문 다시 생성"
            />
          )}

          {surveyError && (
            <ErrorBlock>설문 생성 오류: {surveyError}</ErrorBlock>
          )}
        </WizardCard>
      )}

      {/* CARD 3 — Google Form 생성. Card 2 승인 전에는 렌더 X. */}
      {surveyPhase === 'approved' && (
        <WizardCard
          index={3}
          title="Google Form 생성"
          phase={published ? 'approved' : 'review'}
          accentColor="amore"
        >
          <FormPublishRow
            google={google}
            googleAuthError={googleAuthError}
            publishing={publishing}
            published={published}
            publishError={publishError}
            onPublish={() => requireAuth(() => void publishToGoogle())}
            onConnect={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/api/recruiting/google/start';
              }
            }}
            onClearAuthError={() => setGoogleAuthError(null)}
          />
        </WizardCard>
      )}

      {/* Approval modal — shared across cards 1 & 2 */}
      <ReviewModal
        state={modal}
        onClose={() => setModal({ open: false })}
        editedBrief={editedBrief}
        survey={survey}
        criteriaCard={criteriaPhase}
        surveyCard={surveyPhase}
        onEditedBriefChange={(next) => setEditedBrief(next)}
        onSurveyChange={(next) => setSurvey(next)}
        onApproveCriteria={() => {
          approveCriteria();
          setModal({ open: false });
        }}
        onApproveSurvey={() => {
          approveSurvey();
          setModal({ open: false });
        }}
      />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function WizardCard({
  index,
  title,
  phase,
  accentColor,
  collapseOnApprove = false,
  children,
}: {
  index: number;
  title: string;
  phase: Phase;
  accentColor: 'amore';
  collapseOnApprove?: boolean;
  children?: ReactNode;
}) {
  void accentColor;
  // Auto-collapse when the user approves so the wizard's focus shifts to
  // the next active card. Header stays clickable for manual expand/collapse.
  // Sync via render-conditional setState (the codebase's `seededFor` pattern)
  // rather than useEffect, which the react-hooks/set-state-in-effect rule
  // forbids.
  const [collapsed, setCollapsed] = useState(false);
  const [trackedPhase, setTrackedPhase] = useState<Phase>(phase);
  if (collapseOnApprove && phase !== trackedPhase) {
    setTrackedPhase(phase);
    setCollapsed(phase === 'approved');
  }

  const toggle = collapseOnApprove
    ? () => setCollapsed((c) => !c)
    : undefined;

  return (
    <section className="border border-line bg-paper rounded-sm transition-opacity">
      <header
        className={[
          'flex items-center gap-3 px-4 py-3',
          collapsed ? '' : 'border-b border-line-soft',
          toggle ? 'cursor-pointer select-none' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role={toggle ? 'button' : undefined}
        tabIndex={toggle ? 0 : undefined}
        aria-expanded={toggle ? !collapsed : undefined}
        onClick={toggle}
        onKeyDown={
          toggle
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
      >
        <span
          className={
            phase === 'approved'
              ? 'inline-flex h-6 w-6 items-center justify-center border border-amore bg-amore text-paper text-xs font-semibold rounded-full'
              : 'inline-flex h-6 w-6 items-center justify-center border border-ink text-ink text-xs font-semibold rounded-full'
          }
        >
          {phase === 'approved' ? '✓' : index}
        </span>
        <h3 className="text-md font-semibold text-ink-2">{title}</h3>
        {phase === 'approved' && (
          <span className="text-sm text-amore">승인됨</span>
        )}
        {toggle && (
          <span
            className="ml-auto text-sm text-mute-soft"
            aria-hidden="true"
          >
            {collapsed ? '▸' : '▾'}
          </span>
        )}
      </header>
      {!collapsed && <div className="px-4 py-4">{children}</div>}
    </section>
  );
}

function CriteriaInputArea({
  files,
  pasted,
  rejected,
  running,
  onPasteChange,
  onAddFiles,
  onRemoveFile,
  onExtract,
  canExtract,
  error,
}: {
  files: File[];
  pasted: string;
  rejected: string[];
  running: boolean;
  onPasteChange: (v: string) => void;
  onAddFiles: (incoming: FileList | File[]) => void;
  onRemoveFile: (idx: number) => void;
  onExtract: () => void;
  canExtract: boolean;
  error: CardError;
}) {
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col">
          <label className="mb-2 block text-sm font-semibold text-ink-2">
            텍스트 붙여넣기
          </label>
          <Textarea
            value={pasted}
            onChange={(e) => onPasteChange(e.target.value)}
            disabled={running}
            placeholder="이메일, 메신저, 브리프 텍스트를 그대로 붙여넣으세요."
            className="h-[60px] resize-none text-md text-ink-2"
          />
        </div>
        <div className="flex flex-col">
          <label className="mb-2 block text-sm font-semibold text-ink-2">
            파일 업로드
          </label>
          <FileDropZone
            accept={ACCEPT}
            multiple
            onFiles={(f) => onAddFiles(f)}
            label="파일을 끌어다 놓거나 클릭"
            helperText=".pdf · .docx · .xlsx · .csv · .txt — 최대 10개"
            className="h-[60px] gap-2 px-6"
          />
        </div>
      </div>

      {rejected.length > 0 && (
        <div className="mt-3 text-sm text-amore">
          허용되지 않은 형식: {rejected.join(', ')}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-line border border-line bg-paper rounded-sm">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 px-3 py-2 text-md"
            >
              <span className="truncate text-ink-2">{f.name}</span>
              <span className="shrink-0 tabular-nums text-mute-soft">
                {formatBytes(f.size)}
              </span>
              <Button
                variant="destructive-link"
                size="xs"
                onClick={() => onRemoveFile(i)}
                disabled={running}
                className="shrink-0 text-sm"
              >
                제거
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-sm tabular-nums text-mute-soft">
          {files.length}개 파일 · {pasted.length}자
        </span>
        <Button
          variant="primary"
          size="md"
          onClick={onExtract}
          disabled={!canExtract}
        >
          {running ? '추출 중…' : '추출'}
        </Button>
      </div>

      {error && <ErrorBlock>오류: {error}</ErrorBlock>}
    </div>
  );
}

function GeneratingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <MochiLoader size={28} />
      <span className="text-md text-mute">{label}</span>
    </div>
  );
}

function ReviewRow({
  title,
  meta,
  phase,
  onPreview,
  onEdit,
  onApprove,
  onRestart,
  restartLabel,
}: {
  title: string;
  meta?: string;
  phase: Phase;
  onPreview: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onRestart: () => void;
  restartLabel: string;
}) {
  const approved = phase === 'approved';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-ink">{title}</div>
        {meta && <div className="mt-0.5 text-sm text-mute-soft">{meta}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onPreview}>
          프리뷰
        </Button>
        {!approved && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            편집
          </Button>
        )}
        {!approved ? (
          <Button variant="primary" size="sm" onClick={onApprove}>
            승인
          </Button>
        ) : (
          <Button variant="link" size="xs" onClick={onRestart}>
            {restartLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// Google revokes the refresh token if the user changed password, hit
// the 6-month inactivity window, or the OAuth client rotated. The
// server surfaces these as `google_token_refresh_failed` / `invalid_grant`
// / `unauthorized`. When we see one of these, the only recovery is to
// disconnect (drops the stale row) and re-OAuth. Detect via substring so
// the message can wrap upstream JSON without breaking matching.
function isReauthError(msg: string | null): boolean {
  if (!msg) return false;
  return (
    /token_refresh_failed|invalid_grant|unauthorized|google_not_connected/i.test(
      msg,
    )
  );
}

async function reconnectGoogle() {
  try {
    await fetch('/api/recruiting/google/disconnect', { method: 'POST' });
  } catch {
    // Best-effort: even if disconnect fails locally, kicking off
    // /google/start re-runs the OAuth consent flow which overwrites the
    // stored token row.
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/api/recruiting/google/start';
  }
}

function FormPublishRow({
  google,
  googleAuthError,
  publishing,
  published,
  publishError,
  onPublish,
  onConnect,
  onClearAuthError,
}: {
  google: GoogleStatus | null;
  googleAuthError: string | null;
  publishing: boolean;
  published: PublishedForm | null;
  publishError: string | null;
  onPublish: () => void;
  onConnect: () => void;
  onClearAuthError: () => void;
}) {
  const needsReauth = isReauthError(publishError);
  return (
    <div className="space-y-3">
      {published ? (
        <div className="border border-line-soft bg-paper p-3 rounded-sm">
          <div className="font-semibold text-ink">발행 완료</div>
          <div className="mt-1 flex flex-wrap gap-3 text-md">
            <a
              href={published.editUri}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amore underline-offset-2 hover:underline"
            >
              편집 화면 열기
            </a>
            <a
              href={published.responderUri}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink-2 underline-offset-2 hover:underline"
            >
              응답 폼 열기
            </a>
          </div>
          <p className="mt-2 text-sm text-mute-soft">
            아래 산출물 영역에서 시트 자동연결을 진행하세요.
          </p>
        </div>
      ) : google?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-mute-soft">
              승인된 설문을 Google Forms로 발행합니다.
              {google.email ? ` (${google.email})` : ''}
            </p>
            <Button
              variant="link"
              size="xs"
              onClick={() => void reconnectGoogle()}
              className="px-0 py-0 font-normal text-xs-soft text-mute underline underline-offset-2 hover:text-amore"
            >
              다른 계정으로 재연결
            </Button>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={onPublish}
            disabled={publishing}
          >
            {publishing ? '발행 중…' : 'Google Form 생성'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute-soft">
            Google 계정을 연결하면 폼을 자동으로 생성합니다.
          </p>
          <Button variant="primary" size="md" onClick={onConnect}>
            Google 계정 연결
          </Button>
        </div>
      )}

      {google?.connected && !google.hasDrive && (
        <p className="text-sm text-amore">
          공개(anyone with link) 권한 부여를 위해 Google 계정을 다시
          연결해주세요.{' '}
          <Button
            variant="link"
            size="xs"
            onClick={() => void reconnectGoogle()}
            className="px-0 py-0 font-normal text-sm text-amore underline underline-offset-2 hover:text-amore"
          >
            재연결
          </Button>
        </p>
      )}

      {googleAuthError && (
        <div className="flex items-start justify-between gap-3 border border-amore bg-amore-bg p-3 text-md text-amore rounded-sm">
          <span>Google 연결 오류: {googleAuthError}</span>
          <Button
            variant="link"
            size="xs"
            onClick={onClearAuthError}
            className="text-amore"
          >
            닫기
          </Button>
        </div>
      )}

      {publishError && (
        <div className="border border-amore bg-amore-bg p-3 text-md text-amore rounded-sm">
          <div>발행 오류: {publishError}</div>
          {needsReauth && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-sm">
                Google 토큰이 만료/취소된 것 같습니다. 재연결로 복구하세요.
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void reconnectGoogle()}
              >
                Google 재연결
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 border border-amore bg-amore-bg p-3 text-md text-amore rounded-sm">
      {children}
    </div>
  );
}

function ReviewModal({
  state,
  onClose,
  editedBrief,
  survey,
  criteriaCard,
  surveyCard,
  onEditedBriefChange,
  onSurveyChange,
  onApproveCriteria,
  onApproveSurvey,
}: {
  state:
    | { open: false }
    | { open: true; card: 'criteria' | 'survey'; mode: 'preview' | 'editor' };
  onClose: () => void;
  editedBrief: EditableBrief | null;
  survey: Survey | null;
  criteriaCard: Phase;
  surveyCard: Phase;
  onEditedBriefChange: (next: EditableBrief) => void;
  onSurveyChange: (next: Survey) => void;
  onApproveCriteria: () => void;
  onApproveSurvey: () => void;
}) {
  if (!state.open) {
    return <Modal open={false} onClose={onClose}>{null}</Modal>;
  }
  const isCriteria = state.card === 'criteria';
  const isEditor = state.mode === 'editor';
  const targetApproved = isCriteria
    ? criteriaCard === 'approved'
    : surveyCard === 'approved';
  const title = isCriteria
    ? isEditor
      ? '대상자 조건 편집'
      : '대상자 조건 프리뷰'
    : isEditor
      ? '설문 편집'
      : '설문 프리뷰';

  const body = isCriteria ? (
    editedBrief ? (
      isEditor ? (
        <CriteriaEditor
          summary={editedBrief.summary}
          criteria={editedBrief.criteria}
          onSummaryChange={(s) =>
            onEditedBriefChange({ ...editedBrief, summary: s })
          }
          onCriteriaChange={(criteria) =>
            onEditedBriefChange({ ...editedBrief, criteria })
          }
        />
      ) : (
        <CriteriaPreview
          summary={editedBrief.summary}
          criteria={editedBrief.criteria}
        />
      )
    ) : null
  ) : survey ? (
    isEditor ? (
      <SurveyEditor survey={survey} onChange={onSurveyChange} />
    ) : (
      <SurveyPreview survey={survey} />
    )
  ) : null;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={title}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            닫기
          </Button>
          {!targetApproved && (
            <Button
              variant="primary"
              size="sm"
              onClick={isCriteria ? onApproveCriteria : onApproveSurvey}
            >
              승인
            </Button>
          )}
        </>
      }
    >
      {body}
    </Modal>
  );
}
