'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingSetupAccordion — 리크루팅 위젯 setup 을 유스케이스 4-스텝
   아코디언으로 (위젯 세팅 V3 → CD 7상태 정교화, 파일럿 #3). probing/transcript
   setup-accordion 미러 — 공유 셸 `WidgetAccordion`/`Field` 만 쓰고 프레임/색/
   타이포는 셸이 소유.

   STEP1 소스 자료(붙여넣기 + 파일 dropzone → Extract) · STEP2 참여자 조건
   (Extracting=GeneratingRow / Review=chips+ReviewBar+Approve) · STEP3 심사 설문
   (Generating / Review=섹션행+ReviewBar+Approve, 표준 블록 잠금) · STEP4 Google
   설문지 발행(info / Publishing=GeneratingRow+pubLines / Published=링크).

   ── CD 7상태 정교화 (design-handoff/recruiting/) ──────────────────────
   CD `Widgets Canvas 1c.dc.html` recruiting row 의 상태별 프레젠테이션을 기존
   흐름 로직에 배선한다:
     - GeneratingRow  : amore 링 spinner + amore 보더/틴트 (extract·survey·publish)
     - critChip        : caption(mono)+label+Required 알약, required=amore 보더
     - surveySection   : 잠금(표준)=cream 틴트+🔒 / editable=흰색
     - ReviewBar       : ghost(Preview·Edit·Restart / Preview·Regenerate) + amore Approve
     - pubLine         : Form created ✓ / Linking Sheet… active / Share pending
   승인 게이팅: 조건 승인 → 설문 생성, 설문 승인 → 자동 발행. 하단 CTA
   `Publish form →` 는 양쪽 승인 전까지 disabled(부모 소유).

   ⚠️ 셸 제약: 공유 `WidgetAccordion` 노드는 3-상태(active/done/todo)만 —
   CD 의 amore review-ring 노드는 셸이 소유(편집 금지). 여기선 승인 기반
   isComplete 로 "승인 후 green ✓" 를 맞추고, review 신호는 step 내 ReviewBar
   (amore Approve)가 담당한다.

   ⚠️ 순수 프레젠테이션: extract·survey 생성·publish·approve 로직/상태/API 는
   전부 부모(recruiting-card 의 RecruitingSetupFlow)가 소유하고 props 로 내려온다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  WidgetAccordion,
  useWidgetAccordion,
  type AccordionStepConfig,
} from '@/components/canvas/shell/widget-accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { IconButton } from '@/components/ui/icon-button';
import {
  CriteriaEditor,
  CriteriaPreview,
  SurveyEditor,
} from '@/components/recruiting-wizard/views';
import { isStandardSectionTitle } from '@/lib/recruiting/standard-blocks';
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

// ── CD recruiting-only 프리미티브 (토큰만) ─────────────────────────────

// GeneratingRow — LLM/발행 진행 행. CD: amore 링 spinner + amore 틴트 보더/배경.
// (기존 GenRow(BrandLoader) 대체 — CD 는 amore 톤 전용 처리.)
function GeneratingRow({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm border-2 border-amore/35 bg-amore-bg px-4 py-3">
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amore/30 border-t-amore"
      />
      <div className="min-w-0 flex-1">
        <div className="text-md font-semibold text-ink">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-mute-soft">{sub}</div>}
      </div>
    </div>
  );
}

// EmptyDash — 데이터 전 대기 안내 (CD EmptyDash). dashed 보더 + 중앙 텍스트.
function EmptyDash({ label }: { label: string }) {
  return (
    <p className="rounded-sm border border-dashed border-line-soft px-4 py-4 text-center text-xs text-mute-soft">
      {label}
    </p>
  );
}

function ErrorLine({ label }: { label: string }) {
  return <div className="text-sm text-warning">{label}</div>;
}

// critChip — 조건 알약. caption(mono uppercase) + label + optional Required.
// required = amore 보더 + amore Required 태그.
function CriteriaChip({
  category,
  label,
  required,
}: {
  category: string;
  label: string;
  required: boolean;
}) {
  const t = useTranslations('Recruiting.setup');
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-paper px-2.5 py-1 text-md ${
        required ? 'border-amore' : 'border-line'
      }`}
    >
      <span className="font-mono text-xs-soft uppercase tracking-wider text-mute-soft">
        {category}
      </span>
      <span className="font-semibold text-ink">{label}</span>
      {required && (
        <span className="text-xs font-bold text-amore">{t('chipRequired')}</span>
      )}
    </span>
  );
}

// 잠금 아이콘 (표준 블록). 이모지 금지 → 인라인 SVG.
function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-3 stroke-current"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// 문서 글리프 — 설문 섹션 행 좌측 아이콘 (CD surveySection Icon). 이모지 금지.
function DocGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0 stroke-current text-mute"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

// surveySection — 설문 섹션 요약 행. 잠금(표준)=cream 틴트(paper-soft)+🔒 뱃지 /
// editable=흰색. (cream #faf6ea 전용 토큰 부재 → paper-soft 로 보수적 매핑.)
function SurveySectionRow({
  title,
  meta,
  locked,
}: {
  title: string;
  meta: string;
  locked: boolean;
}) {
  const t = useTranslations('Recruiting.setup');
  return (
    <div
      className={`flex items-center gap-2.5 rounded-sm border border-line px-3 py-2.5 ${
        locked ? 'bg-paper-soft' : 'bg-paper'
      }`}
    >
      <DocGlyph />
      <div className="min-w-0 flex-1">
        <div className="truncate text-md font-semibold text-ink">{title}</div>
        <div className="truncate text-xs text-mute-soft">{meta}</div>
      </div>
      {locked && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-xs-soft font-bold text-mute-soft">
          <LockGlyph />
          {t('standardBadge')}
        </span>
      )}
    </div>
  );
}

// ReviewBar — 리뷰 액션 바. ghost 버튼(좌) + spacer + amore Approve(우).
function ReviewBar({
  ghosts,
  approveLabel,
  onApprove,
}: {
  ghosts: ReactNode;
  approveLabel: string;
  onApprove: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {ghosts}
      <div className="flex-1" />
      <Button variant="primary" size="sm" onClick={onApprove}>
        <span aria-hidden className="mr-1">
          ✓
        </span>
        {approveLabel}
      </Button>
    </div>
  );
}

// pubLine — 발행 하위 진행 행. done=success ✓ / active=amore / pending=hollow.
function PubLine({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'active' | 'pending';
}) {
  return (
    <div className="flex items-center gap-2.5 text-md">
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold text-paper ${
          state === 'done'
            ? 'bg-success'
            : state === 'active'
              ? 'bg-amore'
              : 'border border-line-soft'
        }`}
      >
        {state === 'done' ? '✓' : ''}
      </span>
      <span
        className={
          state === 'pending'
            ? 'text-mute-soft'
            : state === 'active'
              ? 'font-semibold text-ink'
              : 'text-ink'
        }
      >
        {label}
      </span>
    </div>
  );
}

// ── STEP1: 소스 자료 입력 (붙여넣기 + 파일 dropzone → Extract) ─────────────
function SourceStepBody({
  files,
  pasted,
  rejected,
  running,
  criteriaPhase,
  canExtract,
  onPasteChange,
  onAddFiles,
  onRemoveFile,
  onExtract,
}: {
  files: File[];
  pasted: string;
  rejected: string[];
  running: boolean;
  criteriaPhase: Phase;
  canExtract: boolean;
  onPasteChange: (v: string) => void;
  onAddFiles: (incoming: FileList | File[]) => void;
  onRemoveFile: (idx: number) => void;
  onExtract: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  // Extract CTA 는 아직 추출 전(idle)에만 노출 — CD state 0b(empty) 우측 정렬.
  const showExtract = criteriaPhase === 'idle';
  return (
    <div className="flex flex-col gap-4">
      {/* CD 스텝1 = paste 박스 위 dropzone 세로 스택(둘 다 풀폭), 필드 라벨 없음. */}
      <Textarea
        value={pasted}
        onChange={(e) => onPasteChange(e.target.value)}
        disabled={running}
        placeholder={t('pastePlaceholder')}
        aria-label={t('pasteLabel')}
        className="h-[64px] resize-none text-md text-ink-2"
      />
      <FileDropZone
        accept={ACCEPT}
        multiple
        onFiles={(f) => onAddFiles(f)}
        label={t('uploadDrop')}
        helperText={t('uploadHint')}
        className="h-[104px] gap-2 px-6"
      />

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

      {showExtract && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={!canExtract}
            onClick={onExtract}
          >
            {t('extractCta')}
          </Button>
        </div>
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
  onApprove,
}: {
  criteriaPhase: Phase;
  editedBrief: EditableBrief | null;
  partialCount: number;
  criteriaError: string | null;
  onEditedBriefChange: (next: EditableBrief) => void;
  onRestart: () => void;
  onApprove: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  // 상세 뷰 토글 — 'chips'(기본 CD) / 'preview'(상세 읽기) / 'edit'(편집).
  const [detail, setDetail] = useState<'chips' | 'preview' | 'edit'>('chips');

  if (criteriaError) {
    return <ErrorLine label={t('criteriaError', { message: criteriaError })} />;
  }
  if (criteriaPhase === 'generating') {
    return (
      <GeneratingRow
        label={t('criteriaGenerating')}
        sub={
          partialCount > 0
            ? t('criteriaGeneratingCount', { count: partialCount })
            : undefined
        }
      />
    );
  }
  if (!editedBrief) {
    return <EmptyDash label={t('criteriaWaiting')} />;
  }

  const approved = criteriaPhase === 'approved';
  const toggle = (v: 'preview' | 'edit') =>
    setDetail((cur) => (cur === v ? 'chips' : v));

  return (
    <div className="flex flex-col gap-3">
      {!approved && (
        <p className="text-xs leading-relaxed text-mute">
          {t('criteriaReviewNote', { count: editedBrief.criteria.length })}
        </p>
      )}

      {/* 기본 = CD 알약. Preview/Edit 토글 시 상세/편집 뷰로 확장. */}
      {detail === 'chips' && (
        <div className="flex flex-wrap gap-2">
          {editedBrief.criteria.map((c, i) => (
            <CriteriaChip
              key={`${c.category}-${c.label}-${i}`}
              category={c.category}
              label={c.label}
              required={c.required}
            />
          ))}
        </div>
      )}
      {detail === 'preview' && (
        <CriteriaPreview
          summary={editedBrief.summary}
          criteria={editedBrief.criteria}
        />
      )}
      {detail === 'edit' && (
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
      )}

      {!approved && (
        <ReviewBar
          ghosts={
            <>
              <Button
                variant="secondary"
                size="xs"
                data-open={detail === 'preview'}
                onClick={() => toggle('preview')}
              >
                {t('preview')}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                data-open={detail === 'edit'}
                onClick={() => toggle('edit')}
              >
                {t('edit')}
              </Button>
              <Button variant="ghost" size="xs" onClick={onRestart}>
                {t('criteriaRestart')}
              </Button>
            </>
          }
          approveLabel={t('approveCriteria')}
          onApprove={onApprove}
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
  onApprove,
}: {
  criteriaPhase: Phase;
  surveyPhase: Phase;
  survey: Survey | null;
  surveyError: string | null;
  onSurveyChange: (next: Survey) => void;
  onRegenerateSurvey: () => void;
  onApprove: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  // 기본 = CD 섹션 요약 행. Preview 토글 시 편집 가능한 SurveyEditor 확장
  // (표준 블록 잠금 + 도메인 질문 편집 — 편집 경로 보존).
  const [expanded, setExpanded] = useState(false);

  if (surveyError) {
    return <ErrorLine label={t('surveyError', { message: surveyError })} />;
  }
  if (surveyPhase === 'generating') {
    return <GeneratingRow label={t('surveyGenerating')} />;
  }
  if (!survey || criteriaPhase !== 'approved') {
    return <EmptyDash label={t('surveyWaiting')} />;
  }

  const approved = surveyPhase === 'approved';
  const questionCount = survey.sections.reduce(
    (n, s) => n + s.questions.length,
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      {!approved && (
        <p className="text-xs leading-relaxed text-mute">
          {t('surveyReviewNote', {
            sections: survey.sections.length,
            questions: questionCount,
          })}
        </p>
      )}

      {expanded ? (
        <SurveyEditor survey={survey} onChange={onSurveyChange} />
      ) : (
        <div className="flex flex-col gap-2">
          {survey.sections.map((s, i) => {
            const locked = isStandardSectionTitle(s.title);
            return (
              <SurveySectionRow
                key={`${s.title}-${i}`}
                title={s.title || t('surveyUntitledSection')}
                meta={
                  locked
                    ? t('surveySectionLocked', { count: s.questions.length })
                    : t('surveySectionEditable', { count: s.questions.length })
                }
                locked={locked}
              />
            );
          })}
        </div>
      )}

      {!approved && (
        <ReviewBar
          ghosts={
            <>
              <Button
                variant="secondary"
                size="xs"
                data-open={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {t('preview')}
              </Button>
              <Button variant="ghost" size="xs" onClick={onRegenerateSurvey}>
                {t('surveyRegenerate')}
              </Button>
            </>
          }
          approveLabel={t('approveSurvey')}
          onApprove={onApprove}
        />
      )}
    </div>
  );
}

// ── STEP4: Google 설문지 발행 ───────────────────────────────────────────
// 발행 진행 stage(0=연결확인,1=폼생성,2=시트연결,3=마무리)를 3-pubLine 상태로.
function pubLineStates(
  stageIdx: number,
): { form: 'done' | 'active' | 'pending'; sheet: 'done' | 'active' | 'pending'; share: 'done' | 'active' | 'pending' } {
  // 0/1: 폼 생성 중 · 2: 시트 연결 중 · 3: 공유/마무리.
  if (stageIdx >= 3) return { form: 'done', sheet: 'done', share: 'active' };
  if (stageIdx >= 2) return { form: 'done', sheet: 'active', share: 'pending' };
  return { form: 'active', sheet: 'pending', share: 'pending' };
}

function PublishStepBody({
  google,
  googleAuthError,
  publishing,
  publishStageIdx,
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
  publishStageIdx: number;
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

  const pub = pubLineStates(publishStageIdx);

  return (
    <div className="flex flex-col gap-3">
      {publishing ? (
        <>
          <GeneratingRow label={publishStageLabel} sub={t('publishAutoSub')} />
          <div className="mt-1 flex flex-col gap-2">
            <PubLine label={t('pubFormCreated')} state={pub.form} />
            <PubLine label={t('pubLinkingSheet')} state={pub.sheet} />
            <PubLine label={t('pubShare')} state={pub.share} />
          </div>
        </>
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
        // CD info row — 링크 아이콘 + 발행 안내 (paper-soft 서브틀 박스).
        <div className="flex items-center gap-2.5 rounded-sm border border-line bg-paper-soft px-3 py-3">
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="size-4 shrink-0 stroke-current text-mute"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
          </svg>
          <p className="text-sm leading-relaxed text-mute">{t('publishInfo')}</p>
        </div>
      ) : (
        <GeneratingRow label={t('googleChecking')} />
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
  canExtract: boolean;
  onPasteChange: (v: string) => void;
  onAddFiles: (incoming: FileList | File[]) => void;
  onRemoveFile: (idx: number) => void;
  onExtract: () => void;
  // STEP2 — criteria
  criteriaPhase: Phase;
  editedBrief: EditableBrief | null;
  partialCount: number;
  criteriaError: string | null;
  onEditedBriefChange: (next: EditableBrief) => void;
  onRestart: () => void;
  onApproveCriteria: () => void;
  // STEP3 — survey
  surveyPhase: Phase;
  survey: Survey | null;
  surveyError: string | null;
  onSurveyChange: (next: Survey) => void;
  onRegenerateSurvey: () => void;
  onApproveSurvey: () => void;
  // STEP4 — publish
  google: RecruitingGoogleStatus | null;
  googleAuthError: string | null;
  publishing: boolean;
  publishStageIdx: number;
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

  // 승인 즉시 해당 스텝을 접는다 — 승인 후 요약행으로 컬랩스해 스크롤 절감
  // (사용자 요청). 사용자가 다시 펼치면(onOpenStep) manual override 로 유지되고,
  // phase 가 그대로 approved 면 이 effect 는 재발화하지 않아 강제로 안 닫는다.
  const { collapse } = accordion;
  useEffect(() => {
    if (props.criteriaPhase === 'approved') collapse(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.criteriaPhase]);
  useEffect(() => {
    if (props.surveyPhase === 'approved') collapse(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.surveyPhase]);

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
          criteriaPhase={props.criteriaPhase}
          canExtract={props.canExtract}
          onPasteChange={props.onPasteChange}
          onAddFiles={props.onAddFiles}
          onRemoveFile={props.onRemoveFile}
          onExtract={props.onExtract}
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
          onApprove={props.onApproveCriteria}
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
          onApprove={props.onApproveSurvey}
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
          publishStageIdx={props.publishStageIdx}
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

  // 완료 판정 = 승인 기반 (CD: green ✓ 는 승인 후에만). 조건/설문은 *승인* 시
  // done, 소스는 존재 시, 발행은 published 시. (셸 노드는 3-상태라 review 링은
  // step 내 ReviewBar 가 담당 — 셸 편집 금지.)
  const isComplete = (index: number): boolean =>
    index === 0
      ? props.criteriaPhase !== 'idle'
      : index === 1
        ? props.criteriaPhase === 'approved'
        : index === 2
          ? props.surveyPhase === 'approved'
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
