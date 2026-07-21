'use client';

/* ────────────────────────────────────────────────────────────────────
   RecruitingSetupAccordion — 리크루팅 세팅 프레젠테이션 (fresh 신규 빌드).

   §E fresh-build: CD `recruiting/Widgets Canvas 1c.dc.html` + BUILD-SPEC
   §1/§1b/§3 + WIDGET-SHELL 대로 신규 생성. 옛 `recruiting-wizard/*` 편집·
   재사용 X. 로직/데이터는 `useRecruitingSetup` 훅(재사용 = api·lib·hooks·
   schema)에서만 받고, 이 파일은 DOM/클래스(프레젠테이션)만 소유한다.

   4-step all-open 아코디언(소스·criteria·설문·발행) — 스텝노드+세로 레일,
   데이터 의존 스텝의 pre-data = CD .dc.html 그대로 솔리드 예시 칩/설문행 +
   `예시` 라벨(§A Rev2 — muted 고스트 폐기), post-data = 실데이터로 교체,
   하단 footNote + 단일 phase CTA. 접기 시
   요약 4행. published 핸드오프는 카드-레벨 WidgetStatusFooter(onPublishedChange).
   문자열 전부 `Recruiting.setup` i18n(하드코딩 0, canonical ko).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { BrandLoader } from '@/components/ui/brand-loader';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { isStandardSectionTitle } from '@/lib/recruiting/standard-blocks';
import type { EditableBrief } from '@/components/recruiting-wizard/draft-storage';
import {
  useRecruitingSetup,
  isReauthError,
  type GoogleStatus,
  type PublishedForm,
} from './use-recruiting-setup';

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

type StepNodeState = 'done' | 'active' | 'todo';

export function RecruitingSetupAccordion({
  onPublishedChange,
  onConditionsChange,
}: {
  onPublishedChange?: (published: boolean) => void;
  onConditionsChange?: (brief: EditableBrief | null) => void;
} = {}) {
  const t = useTranslations('Recruiting');
  const s = useRecruitingSetup({ onPublishedChange, onConditionsChange });
  const [collapsed, setCollapsed] = useState(false);

  const {
    criteriaPhase,
    surveyPhase,
    published,
    publishing,
    criteriaError,
    surveyError,
    publishError,
    editedBrief,
    survey,
    partialCriteria,
  } = s;

  // 위젯 헤더 state pill 동기화 — i18n 라벨(로직 훅엔 하드코딩 0이라 여기서).
  const { setState: setWidgetState } = useWidgetState();
  useEffect(() => {
    if (publishError || criteriaError || surveyError) {
      setWidgetState({
        kind: 'error',
        message: publishError ?? criteriaError ?? surveyError ?? undefined,
      });
      return;
    }
    if (publishing) {
      setWidgetState({ kind: 'running', label: t('setup.statePublishing') });
      return;
    }
    if (surveyPhase === 'generating') {
      setWidgetState({ kind: 'running', label: t('setup.stateSurvey') });
      return;
    }
    if (criteriaPhase === 'generating') {
      setWidgetState({ kind: 'running', label: t('setup.stateExtracting') });
      return;
    }
    if (published) {
      setWidgetState({ kind: 'done' });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [
    setWidgetState,
    t,
    publishing,
    surveyPhase,
    criteriaPhase,
    publishError,
    criteriaError,
    surveyError,
    published,
  ]);

  // ── §3 스텝 노드 상태 파생 ─────────────────────────────────────────
  const stepNode = (i: 1 | 2 | 3 | 4): StepNodeState => {
    if (i === 1) return criteriaPhase === 'idle' ? 'active' : 'done';
    if (i === 2) {
      if (criteriaPhase === 'approved') return 'done';
      if (criteriaPhase === 'generating' || criteriaPhase === 'review')
        return 'active';
      return 'todo';
    }
    if (i === 3) {
      if (surveyPhase === 'approved') return 'done';
      if (
        criteriaPhase === 'approved' &&
        (surveyPhase === 'generating' || surveyPhase === 'review')
      )
        return 'active';
      return 'todo';
    }
    if (published) return 'done';
    if (surveyPhase === 'approved') return 'active';
    return 'todo';
  };

  const anyError = publishError ?? criteriaError ?? surveyError ?? null;
  const footNote = anyError
    ? t('setup.footNoteError')
    : published
      ? t('setup.footNotePublished')
      : surveyPhase === 'approved'
        ? t('setup.footNoteReady')
        : t('setup.footNoteOpen');

  const needsGoogleConnect =
    !!s.google && !s.google.connected && !s.google.adminProxy;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[514px]">
          {/* 접기/펼치기 토글 — §3 open ↔ collapsed */}
          <div className="mb-4 flex justify-end">
            <Button
              variant="link"
              size="xs"
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? t('setup.expand') : t('setup.collapse')}
            </Button>
          </div>

          {collapsed ? (
            <div className="space-y-2">
              <SummaryRow
                index={1}
                nodeState={stepNode(1)}
                label={t('setup.step1Title')}
                value={t('setup.summarySource', { count: s.files.length })}
              />
              <SummaryRow
                index={2}
                nodeState={stepNode(2)}
                label={t('setup.step2Title')}
                value={t('setup.summaryCriteria', {
                  count: editedBrief?.criteria.length ?? 0,
                })}
              />
              <SummaryRow
                index={3}
                nodeState={stepNode(3)}
                label={t('setup.step3Title')}
                value={t('setup.summarySurvey', {
                  sections: survey?.sections.length ?? 0,
                  questions:
                    survey?.sections.reduce(
                      (n, sec) => n + sec.questions.length,
                      0,
                    ) ?? 0,
                })}
              />
              <SummaryRow
                index={4}
                nodeState={stepNode(4)}
                label={t('setup.step4Title')}
                value={t('setup.summaryPublish')}
              />
            </div>
          ) : (
            <>
              {/* STEP 1 — 소스 업로드 */}
              <SetupStep
                index={1}
                nodeState={stepNode(1)}
                title={t('setup.step1Title')}
              >
                <SourceInputFields
                  files={s.files}
                  pasted={s.pasted}
                  rejected={s.rejected}
                  running={s.jobRunning}
                  onPasteChange={s.setPasted}
                  onAddFiles={s.addFiles}
                  onRemoveFile={s.removeFile}
                />
                {criteriaError && (
                  <div className="mt-3">
                    <ErrorBlock>
                      {t('setup.errorPrefix')}: {criteriaError}
                    </ErrorBlock>
                  </div>
                )}
              </SetupStep>

              {/* STEP 2 — 참여자 조건 (criteria chips) */}
              <SetupStep
                index={2}
                nodeState={stepNode(2)}
                title={t('setup.step2Title')}
              >
                {criteriaPhase === 'idle' && (
                  // pre-data = CD .dc.html recruitOpen 그대로 솔리드 예시 4칩
                  // (라벨 없음 — .dc.html 에 example eyebrow 없음). post-data 로 교체.
                  <div className="flex flex-wrap gap-2">
                    <CriteriaChip
                      category={t('setup.ghostCat1')}
                      label={t('setup.ghostCrit1')}
                      required
                      requiredLabel={t('setup.required')}
                    />
                    <CriteriaChip
                      category={t('setup.ghostCat2')}
                      label={t('setup.ghostCrit2')}
                      required
                      requiredLabel={t('setup.required')}
                    />
                    <CriteriaChip
                      category={t('setup.ghostCat3')}
                      label={t('setup.ghostCrit3')}
                      required={false}
                      requiredLabel={t('setup.required')}
                    />
                    <CriteriaChip
                      category={t('setup.ghostCat4')}
                      label={t('setup.ghostCrit4')}
                      required={false}
                      requiredLabel={t('setup.required')}
                    />
                  </div>
                )}
                {criteriaPhase === 'generating' && (
                  <GeneratingRow
                    label={
                      partialCriteria.length > 0
                        ? t('setup.extractingCount', {
                            count: partialCriteria.length,
                          })
                        : t('setup.extracting')
                    }
                  />
                )}
                {(criteriaPhase === 'review' || criteriaPhase === 'approved') &&
                  editedBrief && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {editedBrief.criteria.map((c, i) => (
                          <CriteriaChip
                            key={`${c.category}-${c.label}-${i}`}
                            category={c.category}
                            label={c.label}
                            required={c.required}
                            requiredLabel={t('setup.required')}
                          />
                        ))}
                      </div>
                      {criteriaPhase === 'review' && (
                        <Button
                          variant="link"
                          size="xs"
                          onClick={s.restartCriteria}
                        >
                          {t('setup.restartCriteria')}
                        </Button>
                      )}
                    </div>
                  )}
              </SetupStep>

              {/* STEP 3 — 스크리닝 설문 (locked + editable) */}
              <SetupStep
                index={3}
                nodeState={stepNode(3)}
                title={t('setup.step3Title')}
              >
                {criteriaPhase !== 'approved' && (
                  // pre-data = CD .dc.html recruitOpen 그대로 솔리드 예시 설문행
                  // (라벨 없음). post-data 로 교체.
                  <div className="space-y-2">
                    <SurveySectionRow
                      title={t('setup.ghostSurvConsent')}
                      meta={t('setup.ghostSurvConsentMeta')}
                      locked
                      lockedLabel={t('setup.surveyLocked')}
                    />
                    <SurveySectionRow
                      title={t('setup.ghostSurvScreen')}
                      meta={`${t('setup.surveyQuestionMeta', { count: 8 })} · ${t('setup.surveyEditable')}`}
                      locked={false}
                      lockedLabel={t('setup.surveyLocked')}
                    />
                    <SurveySectionRow
                      title={t('setup.ghostSurvPersonal')}
                      meta={t('setup.ghostSurvPersonalMeta')}
                      locked
                      lockedLabel={t('setup.surveyLocked')}
                    />
                  </div>
                )}
                {criteriaPhase === 'approved' &&
                  (surveyPhase === 'idle' || surveyPhase === 'generating') && (
                    <GeneratingRow label={t('setup.generatingSurvey')} />
                  )}
                {(surveyPhase === 'review' || surveyPhase === 'approved') &&
                  survey && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {survey.sections.map((sec, i) => {
                          const locked = isStandardSectionTitle(sec.title);
                          const meta = t('setup.surveyQuestionMeta', {
                            count: sec.questions.length,
                          });
                          return (
                            <SurveySectionRow
                              key={`${sec.title}-${i}`}
                              title={sec.title}
                              meta={
                                locked
                                  ? meta
                                  : `${meta} · ${t('setup.surveyEditable')}`
                              }
                              locked={locked}
                              lockedLabel={t('setup.surveyLocked')}
                            />
                          );
                        })}
                      </div>
                      {surveyPhase === 'review' && (
                        <Button
                          variant="link"
                          size="xs"
                          onClick={s.regenerateSurvey}
                        >
                          {t('setup.regenerateSurvey')}
                        </Button>
                      )}
                    </div>
                  )}
                {surveyError && (
                  <div className="mt-3">
                    <ErrorBlock>
                      {t('setup.surveyErrorPrefix')}: {surveyError}
                    </ErrorBlock>
                  </div>
                )}
              </SetupStep>

              {/* STEP 4 — Google Form 발행 */}
              <SetupStep
                index={4}
                nodeState={stepNode(4)}
                title={t('setup.step4Title')}
                isLast
              >
                <div className="space-y-3">
                  {/* §H — publish info = surface-elevated(paper-soft) + link
                      아이콘 + rounded-chrome(12). */}
                  <div className="flex items-center gap-2 rounded-chrome border border-line bg-paper-soft px-3.5 py-3 text-md text-mute">
                    <LinkIcon />
                    <span>{t('setup.publishInfo')}</span>
                  </div>
                  {surveyPhase === 'approved' && (
                    <PublishPanel
                      google={s.google}
                      googleAuthError={s.googleAuthError}
                      publishing={publishing}
                      published={published}
                      publishError={publishError}
                      onRetry={s.retryPublish}
                      onConnect={s.connectGoogle}
                      onReconnect={s.reconnectGoogle}
                      onClearAuthError={s.clearGoogleAuthError}
                    />
                  )}
                </div>
              </SetupStep>
            </>
          )}
        </div>
      </div>

      {/* 푸터 — footNote(좌, mono) + 단일 phase CTA(우). published 는 카드-레벨
          WidgetStatusFooter 가 응답 보기 핸드오프 담당(여기 CTA null). */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft px-6 py-3">
        <span className="font-mono text-xs text-mute">{footNote}</span>
        <SetupFooterCta
          published={!!published}
          publishing={publishing}
          criteriaPhase={criteriaPhase}
          surveyPhase={surveyPhase}
          hasSurvey={!!survey}
          hasEditedBrief={!!editedBrief}
          needsGoogleConnect={needsGoogleConnect}
          canExtract={s.canExtract}
          onExtract={s.startExtract}
          onApproveCriteria={s.approveCriteria}
          onApproveSurvey={s.approveSurvey}
          onConnectGoogle={s.connectGoogle}
        />
      </div>
    </div>
  );
}

// ── 프레젠테이션 sub-components (CD .dc.html · BUILD-SPEC §1 대로) ────────

// 4-step 아코디언 스텝 셸 (WIDGET-SHELL §S1: node 26 · rail 2px ink/12 ·
// title 14.5/800). node: done(✓ success) / active(ink) / todo(dim).
function SetupStep({
  index,
  nodeState,
  title,
  isLast = false,
  children,
}: {
  index: number;
  nodeState: StepNodeState;
  title: string;
  isLast?: boolean;
  children?: ReactNode;
}) {
  const nodeClass =
    nodeState === 'done'
      ? 'bg-success text-paper'
      : nodeState === 'active'
        ? 'bg-ink text-paper'
        : 'bg-ink/5 text-mute';
  return (
    <div className={`relative pl-[38px] ${isLast ? '' : 'pb-1'}`}>
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[12px] top-[26px] bottom-0 w-[2px] bg-ink/10"
        />
      )}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-sm font-semibold ${nodeClass}`}
      >
        {nodeState === 'done' ? '✓' : index}
      </span>
      {/* §S1a 스텝 타이틀 = 14.5px/700(❌ text-xl semibold). rem arbitrary
          (0.906rem=14.5px) — px 토큰 없음, 셸 §S1 절대값. */}
      <h3 className="text-[0.906rem] font-bold text-ink">{title}</h3>
      <div className="mt-3 mb-6">{children}</div>
    </div>
  );
}

// criteria chip — required=amore border, nice-to-have=line border, category
// eyebrow(mono). recruiting §1: `rounded-pill border-amore` / `border-line`.
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
      className={`inline-flex items-center gap-1.5 rounded-pill border bg-paper px-3 py-1.5 text-md ${
        required ? 'border-amore' : 'border-line'
      }`}
    >
      {category && (
        <span className="font-mono text-xs uppercase tracking-wide text-mute-soft">
          {category}
        </span>
      )}
      <span className="font-semibold text-ink">{label}</span>
      {required && (
        <span className="text-xs font-bold text-amore">{requiredLabel}</span>
      )}
    </span>
  );
}

// link 아이콘 — CD publish info 좌측. 인라인 SVG(외부 라이브러리 없음).
function LinkIcon() {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0 text-mute"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.5 10.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1M10.5 7.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 좌측 아이콘 — CD .dc.html: locked=document, editable=minutes(clock). 인라인
// SVG(외부 라이브러리 없음 — CONTEXT-PACK §2). currentColor=text-mute.
function SectionIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0 text-mute"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      {locked ? (
        <path
          d="M4.5 2.5h6l3 3v10h-9v-13Zm6 0v3h3M6 9h6M6 11.5h6M6 6.5h2.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M9 5.5V9l2.5 1.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

// screening survey section row — locked(🔒)=surface-locked(→paper-soft),
// editable=paper. recruiting §1: `rounded-chrome border-line`(→rounded-sm).
// CD: 좌측 아이콘(document/clock) + title/meta + locked pill.
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
  // §H — radius rounded-chrome(12, ❌ rounded-sm) · locked bg surface-locked
  // (#faf6ea, ❌ paper-soft).
  return (
    <div
      className={`flex items-center gap-2.5 rounded-chrome border border-line px-3 py-2.5 ${
        locked ? 'bg-surface-locked' : 'bg-paper'
      }`}
    >
      <SectionIcon locked={locked} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-md font-bold text-ink">{title}</div>
        <div className="mt-0.5 text-xs text-mute-soft">{meta}</div>
      </div>
      {locked && (
        <span className="shrink-0 rounded-pill border border-line px-2 py-0.5 font-mono text-xs text-mute-soft">
          {lockedLabel}
        </span>
      )}
    </div>
  );
}

// collapsed 요약 행 (§3 collapsed) — 노드 + 라벨 + 요약값.
function SummaryRow({
  index,
  nodeState,
  label,
  value,
}: {
  index: number;
  nodeState: StepNodeState;
  label: string;
  value: string;
}) {
  const nodeClass =
    nodeState === 'done'
      ? 'bg-success text-paper'
      : nodeState === 'active'
        ? 'bg-ink text-paper'
        : 'bg-ink/5 text-mute';
  return (
    <div className="flex items-center gap-3 rounded-sm border border-line bg-paper px-3 py-2.5">
      <span
        aria-hidden="true"
        className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-sm font-semibold ${nodeClass}`}
      >
        {nodeState === 'done' ? '✓' : index}
      </span>
      <span className="min-w-0 flex-1 truncate text-md font-semibold text-ink">
        {label}
      </span>
      <span className="shrink-0 font-mono text-xs text-mute-soft">{value}</span>
    </div>
  );
}

function GeneratingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <BrandLoader size={28} />
      <span className="text-md text-mute">{label}</span>
    </div>
  );
}

function ErrorBlock({ children }: { children: ReactNode }) {
  return (
    <div className="border-2 border-warning-line bg-warning-bg shadow-memphis-md-warning p-3 text-md text-ink-2 rounded-sm">
      {children}
    </div>
  );
}

// STEP 1 소스 입력 — 붙여넣기 + 파일 dropzone. 문자열 전부 i18n(§7).
function SourceInputFields({
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
  const t = useTranslations('Recruiting');
  // CD .dc.html criteriaInput: compact 붙여넣기 박스(min-h 50) STACKED 위,
  // 그 아래 compact 드롭존(pad 16). 필드 라벨 없음(aria-label 만). 옛 wizard
  // 의 side-by-side h-[140px] + Field 라벨 잔재 제거 — 4스텝이 카드에 맞도록.
  return (
    <div className="space-y-2.5">
      <Textarea
        value={pasted}
        onChange={(e) => onPasteChange(e.target.value)}
        disabled={running}
        placeholder={t('setup.step1Paste')}
        aria-label={t('setup.step1PasteLabel')}
        rows={2}
        className="min-h-[52px] resize-none text-md text-ink-2"
      />
      <FileDropZone
        accept={ACCEPT}
        multiple
        onFiles={(f) => onAddFiles(f)}
        label={t('setup.step1Drop')}
        helperText={t('setup.step1DropHint')}
        className="gap-1.5 px-6 py-4"
      />

      {rejected.length > 0 && (
        <div className="text-sm text-warning">
          {t('setup.step1Rejected')}: {rejected.join(', ')}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-line border border-line bg-paper rounded-sm">
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
                {t('setup.step1Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// STEP 4 발행 패널 — 연결/발행중/발행완료(링크)/에러/drive힌트/auth에러.
function PublishPanel({
  google,
  googleAuthError,
  publishing,
  published,
  publishError,
  onRetry,
  onConnect,
  onReconnect,
  onClearAuthError,
}: {
  google: GoogleStatus | null;
  googleAuthError: string | null;
  publishing: boolean;
  published: PublishedForm | null;
  publishError: string | null;
  onRetry: () => void;
  onConnect: () => void;
  onReconnect: () => void;
  onClearAuthError: () => void;
}) {
  const t = useTranslations('Recruiting');
  const needsReauth = isReauthError(publishError) && !google?.adminProxy;
  const [copied, setCopied] = useState(false);

  async function copyResponderUri() {
    if (!published?.responderUri) return;
    try {
      await navigator.clipboard.writeText(published.responderUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard 차단(일부 embed permissions-policy) — 텍스트 수동 선택 가능.
    }
  }

  return (
    <div className="space-y-3">
      {publishing ? (
        <GeneratingRow label={t('setup.publishing')} />
      ) : published ? (
        <div className="flex flex-wrap items-center gap-2 text-md">
          <span className="shrink-0 text-sm text-mute-soft">
            {t('setup.publishAttendeeLabel')}
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
            {copied ? t('setup.publishCopied') : t('setup.publishCopy')}
          </Button>
        </div>
      ) : google && !google.connected && !google.adminProxy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute-soft">
            {t('setup.publishConnectHint')}
          </p>
          <Button variant="primary" size="md" onClick={onConnect}>
            {t('setup.publishConnectCta')}
          </Button>
        </div>
      ) : publishError ? (
        <div className="border-2 border-warning-line bg-warning-bg shadow-memphis-md-warning p-3 text-md text-ink-2 rounded-sm">
          <div>
            {t('setup.publishErrorPrefix')}: {publishError}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {needsReauth ? (
              <>
                <span className="text-sm">{t('setup.publishReauthHint')}</span>
                <Button variant="primary" size="sm" onClick={onReconnect}>
                  {t('setup.publishReconnect')}
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={onRetry}>
                {t('setup.publishRetry')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <GeneratingRow label={t('setup.publishing')} />
      )}

      {google?.connected && !google.hasDrive && !google.adminProxy && (
        <p className="text-sm text-amore">
          {t('setup.publishDriveHint')}{' '}
          <Button
            variant="link"
            size="xs"
            onClick={onReconnect}
            className="px-0 py-0 font-normal text-sm text-amore underline underline-offset-2 hover:text-amore"
          >
            {t('setup.publishDriveReconnect')}
          </Button>
        </p>
      )}

      {googleAuthError && (
        <div className="flex items-start justify-between gap-3 border-2 border-warning-line bg-warning-bg shadow-memphis-md-warning p-3 text-md text-ink-2 rounded-sm">
          <span>
            {t('setup.googleAuthErrorPrefix')}: {googleAuthError}
          </span>
          <Button
            variant="link"
            size="xs"
            onClick={onClearAuthError}
            className="text-warning"
          >
            {t('setup.googleAuthClose')}
          </Button>
        </div>
      )}
    </div>
  );
}

// 푸터 primary CTA — phase 별 "다음 행동" 단일 버튼. 부모 render 에서 객체를
// 만들지 않고 여기서 primitive 로 분기(react-compiler 정합). published =
// 카드-레벨 WidgetStatusFooter 핸드오프이므로 null.
const NOOP = () => {};

function SetupFooterCta({
  published,
  publishing,
  criteriaPhase,
  surveyPhase,
  hasSurvey,
  hasEditedBrief,
  needsGoogleConnect,
  canExtract,
  onExtract,
  onApproveCriteria,
  onApproveSurvey,
  onConnectGoogle,
}: {
  published: boolean;
  publishing: boolean;
  criteriaPhase: string;
  surveyPhase: string;
  hasSurvey: boolean;
  hasEditedBrief: boolean;
  needsGoogleConnect: boolean;
  canExtract: boolean;
  onExtract: () => void;
  onApproveCriteria: () => void;
  onApproveSurvey: () => void;
  onConnectGoogle: () => void;
}) {
  const t = useTranslations('Recruiting');
  if (published) return null;

  let label: string;
  let onClick: () => void = NOOP;
  let disabled = false;
  let busy = false;
  if (publishing) {
    label = t('setup.ctaPublishing');
    busy = true;
  } else if (surveyPhase === 'approved') {
    if (needsGoogleConnect) {
      label = t('setup.ctaConnectGoogle');
      onClick = onConnectGoogle;
    } else {
      label = t('setup.ctaPublishing');
      busy = true;
    }
  } else if (surveyPhase === 'generating') {
    label = t('setup.ctaGeneratingSurvey');
    busy = true;
  } else if (
    criteriaPhase === 'approved' &&
    surveyPhase === 'review' &&
    hasSurvey
  ) {
    label = t('setup.ctaApproveSurvey');
    onClick = onApproveSurvey;
  } else if (criteriaPhase === 'review' && hasEditedBrief) {
    label = t('setup.ctaApproveCriteria');
    onClick = onApproveCriteria;
  } else if (criteriaPhase === 'generating') {
    label = t('setup.ctaExtracting');
    busy = true;
  } else {
    label = t('setup.ctaExtract');
    onClick = onExtract;
    disabled = !canExtract;
  }

  // §S1/§G CTA — active = ink 필 pill(Button primary=bg-ink, size cta=rounded-pill).
  // ❌ ChromeButton primary(amore·각진). idle/disabled = surface-disabled+mute-soft.
  return (
    <Button
      variant="primary"
      size="cta"
      onClick={onClick}
      disabled={disabled || busy}
      className="disabled:border-line disabled:bg-surface-disabled disabled:text-mute-soft disabled:shadow-none"
    >
      {label}
    </Button>
  );
}
