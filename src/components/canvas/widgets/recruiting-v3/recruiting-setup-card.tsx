'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingSetupCard — 리크루팅 V3 세팅 카드 (fresh 프레젠테이션).

   design-handoff SSOT (`Widgets Canvas 1c.dc.html` Recruiting row + README
   "Recruiting") 대로 셸(WidgetSetupShell) + 4스텝 rail 을 **신규 빌드**한다.
   로직/데이터/i18n 은 재사용(useRecruitingSetup 훅 · 응답 fullview) — §C
   fresh-build 규칙(프레젠테이션 fresh, 로직 재사용).

   4스텝: (1) 소스 업로드 (2) 참여자 조건 검토 (3) 스크리닝 설문 검토
   (4) Google Form 발행. 단일 "Publish form →" CTA (SSOT) — 추출·조건승인은
   auto-chain, 사용자는 리뷰 후 한 번의 발행만. 문자열 0 하드코딩(i18n 키만).

   Runtime states (SSOT): All Open(rail) · Published(handoff) · All Collapsed
   (SummaryStep). published 시 CTA = "View responses →" → 응답 전체보기.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import type { WidgetContent } from '../../widget-types';
import type { DragHandleProps } from '../../shell/widget-shell';
import { resolveWidgetLabel } from '../../widget-types';
import {
  WidgetSetupShell,
  type SetupShellCta,
  type SetupShellStatus,
} from '../../shell-v2/widget-setup-shell';
import {
  Rail,
  StepRow,
  NodeNum,
  StepTitle,
  SummaryRow,
  HandoffView,
  MONO,
} from '../../shell-v2/primitives';
import { Icon } from '../../shell-v2/icons';
import { useRecruitingSetup } from './use-recruiting-setup';
import { RecruitingResponsesFullview } from '../recruiting-card';
import {
  PRIVACY_CONSENT_SECTION_TITLE,
  PERSONAL_SECTION_TITLE,
} from '@/lib/recruiting/standard-blocks';

const ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt';
// 붙여넣기 텍스트가 이 길이 이상이면 자동 추출 발화 (한두 글자 입력 중
// 조기 발화 방지 — SSOT 단일 CTA 를 위해 추출은 auto-chain).
const AUTO_EXTRACT_MIN = 40;

// ── 소스 파일 chip (제거 가능) ──────────────────────────────────────
function FileChip({
  name,
  onRemove,
  removeLabel,
}: {
  name: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: '1.4px solid var(--widget-border-soft)',
        borderRadius: 999,
        padding: '5px 11px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--widget-ink)',
        background: 'var(--widget-surface-card)',
        maxWidth: 200,
      }}
    >
      <span
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {name}
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={removeLabel}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRemove();
          }
        }}
        style={{ color: 'var(--widget-placeholder)', cursor: 'pointer', fontSize: 13 }}
      >
        ✕
      </span>
    </span>
  );
}

// ── 참여자 조건 chip (솔리드 — muted/고스트 금지) ────────────────────
function CriteriaChip({
  category,
  label,
  required,
  requiredLabel,
}: {
  category: string;
  label: string;
  required: boolean;
  requiredLabel: string;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: required
          ? '1.4px solid var(--widget-amore)'
          : '1.4px solid var(--widget-border-soft)',
        borderRadius: 999,
        padding: '6px 11px',
        fontSize: 12,
        background: 'var(--widget-surface-card)',
      }}
    >
      {category && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--widget-muted-2)',
          }}
        >
          {category}
        </span>
      )}
      <span style={{ fontWeight: 600, color: 'var(--widget-ink)' }}>{label}</span>
      {required && (
        <span style={{ fontSize: 10, color: 'var(--widget-amore)', fontWeight: 700 }}>
          {requiredLabel}
        </span>
      )}
    </span>
  );
}

// ── 스크리닝 설문 섹션 행 (locked = #faf6ea fill + 🔒 Standard) ───────
function SurveySectionRow({
  title,
  meta,
  locked,
  lockedLabel,
}: {
  title: string;
  meta: string;
  locked: boolean;
  lockedLabel: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        border: '1.4px solid var(--widget-border-soft)',
        borderRadius: 12,
        padding: '11px 13px',
        background: locked ? 'var(--widget-surface-locked)' : 'var(--widget-surface-card)',
      }}
    >
      <span style={{ color: 'var(--widget-muted-2)' }}>
        <Icon name={locked ? 'document' : 'minutes'} size={18} mono />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--widget-ink)' }}>
          {title}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--widget-muted-2)', marginTop: 1 }}>
          {meta}
        </div>
      </div>
      {locked && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            color: 'var(--widget-muted-2)',
            border: '1.3px solid var(--widget-border-soft)',
            borderRadius: 999,
            padding: '3px 8px',
            flexShrink: 0,
          }}
        >
          {lockedLabel}
        </div>
      )}
    </div>
  );
}

// 진행 중(추출/설문 생성) 표시 — 스텝 body 안 인라인.
function ProgressLine({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12.5,
        color: 'var(--widget-muted)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: 'var(--widget-amore)',
          display: 'inline-block',
        }}
      />
      {label}
    </div>
  );
}

export function RecruitingSetupCard({
  content,
  dragHandleProps,
  onFullview,
}: {
  content: WidgetContent;
  dragHandleProps?: DragHandleProps;
  onFullview?: () => void;
}) {
  const t = useTranslations('Recruiting.setup');
  const tRoot = useTranslations();
  const s = useRecruitingSetup();

  // 사용자 수동 접기(All Collapsed) — 세팅 완료(설문 리뷰~승인) 이후 토글 가능.
  const [collapsed, setCollapsed] = useState(false);

  const {
    files,
    pasted,
    setPasted,
    addFiles,
    removeFile,
    rejected,
    criteriaPhase,
    surveyPhase,
    partialCriteria,
    survey,
    published,
    publishing,
    approveSurvey,
    approveCriteria,
    startExtract,
    editedBrief,
    jobRunning,
    criteriaError,
    surveyError,
    publishError,
  } = s;

  const pastedLen = pasted.trim().length;
  const hasSource = files.length > 0 || pastedLen > 0;
  const anyError = !!(criteriaError || surveyError || publishError);
  const setupComplete = surveyPhase === 'review' || surveyPhase === 'approved';

  // auto-chain 1 — 소스 충분 시 추출 자동 발화 (SSOT 단일 CTA).
  // 소스 시그니처당 1회만 — 추출 실패(phase→idle) 시 같은 소스로는 재발화
  // 안 해 무한 재시도를 막고(루프 방지), 사용자가 소스를 바꾸면 새 시그니처라
  // 다시 시도된다(stuck 방지). doExtract 가 시작 시 criteriaError 를 클리어.
  const lastSourceSigRef = useRef<string>('');
  useEffect(() => {
    const sig = files.map((f) => `${f.name}:${f.size}`).join('|') + '::' + pasted.trim();
    if (
      criteriaPhase === 'idle' &&
      !jobRunning &&
      (files.length > 0 || pastedLen >= AUTO_EXTRACT_MIN) &&
      lastSourceSigRef.current !== sig
    ) {
      lastSourceSigRef.current = sig;
      startExtract();
    }
    // startExtract 는 stable useCallback — 재발화는 phase + 시그니처 gate 로 차단.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaPhase, jobRunning, files, pasted, pastedLen]);

  // auto-chain 2 — 조건 추출 완료(review) 시 자동 승인 → 설문 생성.
  useEffect(() => {
    if (criteriaPhase === 'review' && surveyPhase === 'idle' && editedBrief) {
      approveCriteria();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaPhase, surveyPhase, editedBrief]);

  // ── 셸 파생 (status · footNote · cta) ─────────────────────────────
  const status: SetupShellStatus = published
    ? { dot: 'var(--widget-green)', text: t('statusCollecting') }
    : { dot: 'var(--widget-green)', text: t('statusReady') };

  const footNote = anyError
    ? t('footNoteError')
    : published
      ? t('footNotePublished')
      : setupComplete
        ? t('footNoteReady')
        : t('footNoteOpen');

  let cta: SetupShellCta;
  if (published) {
    cta = {
      icon: 'document',
      text: t('viewResponses'),
      enabled: true,
      onClick: onFullview,
    };
  } else if (publishing || surveyPhase === 'approved') {
    // approveSurvey 후 자동 발행 진행 중 (OAuth 왕복 포함).
    cta = { icon: 'link', text: t('ctaPublishing'), enabled: false };
  } else if (surveyPhase === 'review' && survey) {
    // 모든 스텝 리뷰 가능 → 단일 발행 (OAuth 미연결 시 훅이 연결 후 발행).
    cta = { icon: 'link', text: t('ctaPublish'), enabled: true, onClick: approveSurvey };
  } else {
    // 추출/설문 생성 중 또는 소스 미입력 → 발행 비활성.
    cta = { icon: 'link', text: t('ctaPublish'), enabled: false };
  }

  // ── body: published handoff / collapsed summary / open rail ───────
  let body: React.ReactNode;
  if (published) {
    body = (
      <HandoffView title={t('publishedTitle')} sub={t('publishedSub')} />
    );
  } else if (collapsed && setupComplete) {
    const editableQ = (survey?.sections ?? [])
      .filter(
        (sec) =>
          sec.title !== PRIVACY_CONSENT_SECTION_TITLE &&
          sec.title !== PERSONAL_SECTION_TITLE,
      )
      .reduce((n, sec) => n + sec.questions.length, 0);
    const sectionCount = survey?.sections.length ?? 0;
    body = (
      <Rail>
        <SummaryRow
          label={`STEP 01 · ${t('stepShortSource')}`}
          value={t('summarySource', { count: files.length })}
          changeLabel={t('change')}
          onChange={() => setCollapsed(false)}
        />
        <SummaryRow
          label={`STEP 02 · ${t('stepShortCriteria')}`}
          value={t('summaryCriteria', { count: partialCriteria.length })}
          changeLabel={t('change')}
          onChange={() => setCollapsed(false)}
        />
        <SummaryRow
          label={`STEP 03 · ${t('stepShortSurvey')}`}
          value={t('summarySurvey', {
            sections: sectionCount,
            questions: editableQ,
          })}
          changeLabel={t('change')}
          onChange={() => setCollapsed(false)}
        />
        <SummaryRow
          last
          label={`STEP 04 · ${t('stepShortPublish')}`}
          value={t('summaryPublish')}
          changeLabel={t('change')}
          onChange={() => setCollapsed(false)}
        />
      </Rail>
    );
  } else {
    body = (
      <Rail>
        {/* 완료 후 접기 토글 — SSOT All Collapsed 진입점 (setup 완료 시만) */}
        {setupComplete && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <span
              role="button"
              tabIndex={0}
              onClick={() => setCollapsed(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCollapsed(true);
                }
              }}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: 'var(--widget-muted-2)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('collapse')}
            </span>
          </div>
        )}

        {/* STEP 1 · 소스 업로드 */}
        <StepRow node={<NodeNum n={1} />}>
          <StepTitle>{t('step1Title')}</StepTitle>
          <Textarea
            rows={2}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={t('step1Paste')}
            aria-label={t('step1PasteLabel')}
            className="rounded-sm text-sm"
          />
          <div style={{ marginTop: 9 }}>
            <FileDropZone
              accept={ACCEPT}
              multiple
              onFiles={addFiles}
              label={
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--widget-ink)' }}>
                  {t('step1Drop')}
                </span>
              }
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9.5,
                  color: 'var(--widget-placeholder)',
                }}
              >
                {t('step1DropHint')}
              </span>
            </FileDropZone>
          </div>
          {files.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
              {files.map((f, i) => (
                <FileChip
                  key={`${f.name}-${i}`}
                  name={f.name}
                  removeLabel={t('step1Remove')}
                  onRemove={() => removeFile(i)}
                />
              ))}
            </div>
          )}
          {rejected.length > 0 && (
            <div
              style={{ marginTop: 7, fontSize: 11, color: 'var(--widget-amore)' }}
            >
              {t('step1Rejected')}
            </div>
          )}
        </StepRow>

        {/* STEP 2 · 참여자 조건 검토 */}
        <StepRow node={<NodeNum n={2} dim={!hasSource && partialCriteria.length === 0} />}>
          <StepTitle>{t('step2Title')}</StepTitle>
          {criteriaPhase === 'generating' && partialCriteria.length === 0 ? (
            <ProgressLine label={t('extracting')} />
          ) : partialCriteria.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {partialCriteria.map((c, i) => (
                <CriteriaChip
                  key={i}
                  category={c.category}
                  label={c.label}
                  required={c.required}
                  requiredLabel={t('required')}
                />
              ))}
            </div>
          ) : criteriaError ? (
            <div style={{ fontSize: 12, color: 'var(--widget-amore)' }}>
              {t('errorPrefix')}: {criteriaError}
            </div>
          ) : null}
        </StepRow>

        {/* STEP 3 · 스크리닝 설문 검토 */}
        <StepRow node={<NodeNum n={3} dim={!survey} />}>
          <StepTitle>{t('step3Title')}</StepTitle>
          {surveyPhase === 'generating' && !survey ? (
            <ProgressLine label={t('generatingSurvey')} />
          ) : survey ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {survey.sections.map((sec, i) => {
                const locked =
                  sec.title === PRIVACY_CONSENT_SECTION_TITLE ||
                  sec.title === PERSONAL_SECTION_TITLE;
                return (
                  <SurveySectionRow
                    key={i}
                    title={sec.title}
                    locked={locked}
                    lockedLabel={t('surveyLocked')}
                    meta={
                      locked
                        ? t('surveyLocked')
                        : `${t('surveyQuestionMeta', { count: sec.questions.length })} · ${t('surveyEditable')}`
                    }
                  />
                );
              })}
            </div>
          ) : surveyError ? (
            <div style={{ fontSize: 12, color: 'var(--widget-amore)' }}>
              {t('surveyErrorPrefix')}: {surveyError}
            </div>
          ) : null}
        </StepRow>

        {/* STEP 4 · Google Form 발행 */}
        <StepRow last node={<NodeNum n={4} dim={!setupComplete} />}>
          <StepTitle>{t('step4Title')}</StepTitle>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              background: 'var(--widget-surface-subtle)',
              border: '1.4px solid var(--widget-border-hair)',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <span style={{ color: 'var(--widget-muted)' }}>
              <Icon name="link" size={18} mono />
            </span>
            <div style={{ fontSize: 12, color: 'var(--widget-muted)', lineHeight: 1.5 }}>
              {t('publishInfo')}
            </div>
          </div>
          {publishError && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--widget-amore)' }}>
              {t('publishErrorPrefix')}: {publishError}
            </div>
          )}
        </StepRow>
      </Rail>
    );
  }

  return (
    <>
      <WidgetSetupShell
        widgetKey={content.key}
        title={resolveWidgetLabel(tRoot, content.meta)}
        pastelVar="var(--widget-header-sun)"
        creditLabel={String(content.meta.cost ?? '')}
        status={status}
        footNote={footNote}
        cta={cta}
        fullviewLabel={tRoot('Widgets.fullview')}
        onFullview={onFullview}
        dragHandleProps={dragHandleProps}
      >
        {body}
      </WidgetSetupShell>
      {/* 응답 전체보기 슬롯 등록 (재사용, 비가시) */}
      <RecruitingResponsesFullview liveBrief={editedBrief} />
    </>
  );
}
