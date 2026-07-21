'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingSetupAccordion — 리크루팅 위젯 setup 을 유스케이스 4-스텝
   아코디언으로 (위젯 세팅 V3, Canvas 1c). probing/transcript setup-accordion
   미러 — 공유 셸 `WidgetAccordion`/`Field` 만 쓰고 프레임/색/타이포는 셸이 소유.

   STEP1 소스 자료(붙여넣기 + 파일 dropzone → extract) · STEP2 참여자 조건
   (추출 결과 review, CriteriaPreview/Editor 재사용) · STEP3 심사 설문(생성
   결과 review, SurveyEditor 재사용 — 표준 블록 잠금) · STEP4 Google 설문지
   발행(연결/발행/완료 링크).

   ⚠️ 순수 프레젠테이션: extract·survey 생성·publish 로직/상태/API 는 전부
   부모(recruiting-card 의 RecruitingSetupFlow)가 소유하고 props 로 내려온다.
   이 컴포넌트는 스텝을 아코디언으로 배치만 한다 (transcript-setup-accordion
   과 동일 계약). 발행 CTA 는 부모가 WidgetPrimaryCta 로 렌더 — 여기는 스텝만.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { Field } from '@/components/canvas/shell/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { BrandLoader } from '@/components/ui/brand-loader';
import { IconButton } from '@/components/ui/icon-button';
import {
  CriteriaEditor,
  CriteriaPreview,
  SurveyEditor,
} from '@/components/recruiting-wizard/views';
import type { EditableBrief, Phase } from '@/components/recruiting-wizard/draft-storage';
import type { Survey } from '@/lib/survey-schema';

// Google 연결 상태 — recruiting-card(부모) 가 /api/recruiting/google/status
// 로 채워 내려준다. 이 파일이 SSOT 라 부모가 여기서 import.
export type RecruitingGoogleStatus = {
  connected: boolean;
  email: string | null;
  hasDrive: boolean;
  adminProxy: boolean;
};

export type RecruitingPublishedForm = {
  formId: string;
  responderUri: string;
  sheetUrl: string | null;
};

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// 생성/발행 진행 표시 행 (BrandLoader + 라벨) — probing GeneratingRow 미러.
function GenRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <BrandLoader size={28} />
      <span className="text-md text-mute">{label}</span>
    </div>
  );
}

function WaitingHint({ label }: { label: string }) {
  return (
    <p className="rounded-sm border border-dashed border-line-soft px-4 py-4 text-center text-xs text-mute-soft">
      {label}
    </p>
  );
}

function ErrorLine({ label }: { label: string }) {
  return <div className="text-sm text-warning">{label}</div>;
}

// ── STEP1: 소스 자료 입력 (붙여넣기 + 파일 dropzone) ─────────────────────
function SourceStepBody({
  files,
  pasted,
  rejected,
  running,
  onPasteChange,
  onAddFiles,
  onRemoveFile,
}: {
  files: File[];
  pasted: string;
  rejected: string[];
  running: boolean;
  onPasteChange: (v: string) => void;
  onAddFiles: (incoming: FileList | File[]) => void;
  onRemoveFile: (idx: number) => void;
}) {
  const t = useTranslations('Recruiting.setup');
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label={t('pasteLabel')}>
          <Textarea
            value={pasted}
            onChange={(e) => onPasteChange(e.target.value)}
            disabled={running}
            placeholder={t('pastePlaceholder')}
            className="h-[140px] resize-none text-md text-ink-2"
          />
        </Field>
        <Field label={t('uploadLabel')}>
          <FileDropZone
            accept={ACCEPT}
            multiple
            onFiles={(f) => onAddFiles(f)}
            label={t('uploadDrop')}
            helperText={t('uploadHint')}
            className="h-[140px] gap-2 px-6"
          />
        </Field>
      </div>

      {rejected.length > 0 && (
        <ErrorLine label={t('rejected', { names: rejected.join(', ') })} />
      )}

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center gap-3 rounded-sm border border-line-soft bg-paper-soft px-3 py-2.5 text-md"
            >
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {f.name}
              </span>
              <span className="shrink-0 tabular-nums text-mute-soft">
                {formatBytes(f.size)}
              </span>
              <IconButton
                aria-label={t('fileRemove')}
                size="sm"
                variant="ghost"
                onClick={() => onRemoveFile(i)}
                disabled={running}
                className="shrink-0"
              >
                <span aria-hidden>✕</span>
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── STEP2: 참여자 조건 review ───────────────────────────────────────────
function CriteriaStepBody({
  criteriaPhase,
  editedBrief,
  partialCount,
  criteriaError,
  onEditedBriefChange,
  onRestart,
}: {
  criteriaPhase: Phase;
  editedBrief: EditableBrief | null;
  partialCount: number;
  criteriaError: string | null;
  onEditedBriefChange: (next: EditableBrief) => void;
  onRestart: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  const [editing, setEditing] = useState(false);

  if (criteriaError) {
    return <ErrorLine label={t('criteriaError', { message: criteriaError })} />;
  }
  if (criteriaPhase === 'generating') {
    return (
      <GenRow
        label={
          partialCount > 0
            ? t('criteriaGeneratingCount', { count: partialCount })
            : t('criteriaGenerating')
        }
      />
    );
  }
  if (!editedBrief) {
    return <WaitingHint label={t('criteriaWaiting')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? t('criteriaPreviewToggle') : t('criteriaEditToggle')}
        </Button>
        <Button variant="link" size="xs" onClick={onRestart}>
          {t('criteriaRestart')}
        </Button>
      </div>
      {editing ? (
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
      )}
    </div>
  );
}

// ── STEP3: 심사 설문 review ─────────────────────────────────────────────
function SurveyStepBody({
  criteriaPhase,
  surveyPhase,
  survey,
  surveyError,
  onSurveyChange,
  onRegenerateSurvey,
}: {
  criteriaPhase: Phase;
  surveyPhase: Phase;
  survey: Survey | null;
  surveyError: string | null;
  onSurveyChange: (next: Survey) => void;
  onRegenerateSurvey: () => void;
}) {
  const t = useTranslations('Recruiting.setup');

  if (surveyError) {
    return <ErrorLine label={t('surveyError', { message: surveyError })} />;
  }
  if (surveyPhase === 'generating') {
    return <GenRow label={t('surveyGenerating')} />;
  }
  if (!survey || criteriaPhase !== 'approved') {
    return <WaitingHint label={t('surveyWaiting')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button variant="link" size="xs" onClick={onRegenerateSurvey}>
          {t('surveyRegenerate')}
        </Button>
      </div>
      <SurveyEditor survey={survey} onChange={onSurveyChange} />
    </div>
  );
}

// ── STEP4: Google 설문지 발행 ───────────────────────────────────────────
function PublishStepBody({
  google,
  googleAuthError,
  publishing,
  publishStageLabel,
  published,
  publishError,
  needsReauth,
  onConnect,
  onReconnect,
  onRetry,
  onClearAuthError,
}: {
  google: RecruitingGoogleStatus | null;
  googleAuthError: string | null;
  publishing: boolean;
  publishStageLabel: string;
  published: RecruitingPublishedForm | null;
  publishError: string | null;
  needsReauth: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  onClearAuthError: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  const [copied, setCopied] = useState(false);

  async function copyResponderUri() {
    if (!published?.responderUri) return;
    try {
      await navigator.clipboard.writeText(published.responderUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — user can still select the input text manually.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {publishing ? (
        <GenRow label={publishStageLabel} />
      ) : published ? (
        <div className="flex flex-wrap items-center gap-2 text-md">
          <span className="shrink-0 text-sm text-mute-soft">
            {t('responderLabel')}
          </span>
          <Input
            value={published.responderUri}
            readOnly
            size="sm"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copyResponderUri()}
            className="shrink-0"
          >
            {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      ) : google && !google.connected && !google.adminProxy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute-soft">{t('googleConnectHint')}</p>
          <Button variant="primary" size="md" onClick={onConnect}>
            {t('googleConnect')}
          </Button>
        </div>
      ) : publishError ? (
        <div className="rounded-sm border border-warning-line bg-warning-bg p-3 text-md text-ink-2">
          <div>{t('publishErrorLabel', { message: publishError })}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {needsReauth ? (
              <>
                <span className="text-sm">{t('reauthHint')}</span>
                <Button variant="primary" size="sm" onClick={onReconnect}>
                  {t('reconnect')}
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={onRetry}>
                {t('retry')}
              </Button>
            )}
          </div>
        </div>
      ) : google ? (
        <p className="text-sm text-mute-soft">{t('publishInfo')}</p>
      ) : (
        <GenRow label={t('googleChecking')} />
      )}

      {google?.connected && !google.hasDrive && !google.adminProxy && (
        <p className="text-sm text-amore">
          {t('driveHint')}{' '}
          <Button
            variant="link"
            size="xs"
            onClick={onReconnect}
            className="px-0 py-0 text-sm text-amore underline underline-offset-2"
          >
            {t('reconnectShort')}
          </Button>
        </p>
      )}

      {googleAuthError && (
        <div className="flex items-start justify-between gap-3 rounded-sm border border-warning-line bg-warning-bg p-3 text-md text-ink-2">
          <span>{t('authErrorLabel', { message: googleAuthError })}</span>
          <Button
            variant="link"
            size="xs"
            onClick={onClearAuthError}
            className="text-warning"
          >
            {t('close')}
          </Button>
        </div>
      )}
    </div>
  );
}

export type RecruitingSetupAccordionProps = {
  // STEP1 — source
  files: File[];
  pasted: string;
  rejected: string[];
  running: boolean;
  onPasteChange: (v: string) => void;
  onAddFiles: (incoming: FileList | File[]) => void;
  onRemoveFile: (idx: number) => void;
  // STEP2 — criteria
  criteriaPhase: Phase;
  editedBrief: EditableBrief | null;
  partialCount: number;
  criteriaError: string | null;
  onEditedBriefChange: (next: EditableBrief) => void;
  onRestart: () => void;
  // STEP3 — survey
  surveyPhase: Phase;
  survey: Survey | null;
  surveyError: string | null;
  onSurveyChange: (next: Survey) => void;
  onRegenerateSurvey: () => void;
  // STEP4 — publish
  google: RecruitingGoogleStatus | null;
  googleAuthError: string | null;
  publishing: boolean;
  publishStageLabel: string;
  published: RecruitingPublishedForm | null;
  publishError: string | null;
  needsReauth: boolean;
  onConnect: () => void;
  onReconnect: () => void;
  onRetry: () => void;
  onClearAuthError: () => void;
};

export function RecruitingSetupAccordion(props: RecruitingSetupAccordionProps) {
  const t = useTranslations('Recruiting.setup');
  const accordion = useWidgetAccordion();

  const hasSource = props.files.length > 0 || props.pasted.trim().length > 0;
  const sourceSummary = (() => {
    const fileN = props.files.length;
    const hasPaste = props.pasted.trim().length > 0;
    if (fileN > 0 && hasPaste)
      return t('sourceSummaryBoth', { count: fileN });
    if (fileN > 0) return t('sourceSummaryFiles', { count: fileN });
    if (hasPaste) return t('sourceSummaryPaste');
    return t('sourceEmpty');
  })();

  const criteriaSummary = props.editedBrief
    ? t('criteriaSummary', { count: props.editedBrief.criteria.length })
    : t('step2Short');

  const questionCount =
    props.survey?.sections.reduce((n, s) => n + s.questions.length, 0) ?? 0;
  const surveySummary = props.survey
    ? t('surveySummary', {
        sections: props.survey.sections.length,
        questions: questionCount,
      })
    : t('step3Short');

  const publishSummary = props.published
    ? t('publishSummaryDone')
    : t('publishSummaryPending');

  const steps: AccordionStepConfig[] = [
    {
      key: 'source',
      eyebrow: t('stepEyebrow', { n: 1, label: t('step1Short') }),
      title: t('step1Title'),
      summary: sourceSummary,
      body: (
        <SourceStepBody
          files={props.files}
          pasted={props.pasted}
          rejected={props.rejected}
          running={props.running}
          onPasteChange={props.onPasteChange}
          onAddFiles={props.onAddFiles}
          onRemoveFile={props.onRemoveFile}
        />
      ),
    },
    {
      key: 'criteria',
      eyebrow: t('stepEyebrow', { n: 2, label: t('step2Short') }),
      title: t('step2Title'),
      summary: criteriaSummary,
      body: (
        <CriteriaStepBody
          criteriaPhase={props.criteriaPhase}
          editedBrief={props.editedBrief}
          partialCount={props.partialCount}
          criteriaError={props.criteriaError}
          onEditedBriefChange={props.onEditedBriefChange}
          onRestart={props.onRestart}
        />
      ),
    },
    {
      key: 'survey',
      eyebrow: t('stepEyebrow', { n: 3, label: t('step3Short') }),
      title: t('step3Title'),
      summary: surveySummary,
      body: (
        <SurveyStepBody
          criteriaPhase={props.criteriaPhase}
          surveyPhase={props.surveyPhase}
          survey={props.survey}
          surveyError={props.surveyError}
          onSurveyChange={props.onSurveyChange}
          onRegenerateSurvey={props.onRegenerateSurvey}
        />
      ),
    },
    {
      key: 'publish',
      eyebrow: t('stepEyebrow', { n: 4, label: t('step4Short') }),
      title: t('step4Title'),
      summary: publishSummary,
      body: (
        <PublishStepBody
          google={props.google}
          googleAuthError={props.googleAuthError}
          publishing={props.publishing}
          publishStageLabel={props.publishStageLabel}
          published={props.published}
          publishError={props.publishError}
          needsReauth={props.needsReauth}
          onConnect={props.onConnect}
          onReconnect={props.onReconnect}
          onRetry={props.onRetry}
          onClearAuthError={props.onClearAuthError}
        />
      ),
    },
  ];

  const isComplete = (index: number): boolean =>
    index === 0
      ? hasSource
      : index === 1
        ? props.editedBrief != null
        : index === 2
          ? props.survey != null
          : props.published != null;

  return (
    <WidgetAccordion
      steps={steps}
      isExpanded={accordion.isExpanded}
      isComplete={isComplete}
      onOpenStep={accordion.open}
      onCollapseStep={accordion.collapse}
      changeLabel={t('change')}
      optionalLabel={t('optional')}
    />
  );
}
