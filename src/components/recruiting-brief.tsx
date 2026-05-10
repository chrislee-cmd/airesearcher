'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parsePartialJson } from 'ai';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useGenerationJobs } from './generation-job-provider';
import { useWorkspace } from './workspace-provider';
import { RecruitingResponses } from './recruiting-responses';
import { EmptyState } from '@/components/ui/empty-state';
import { FileDropZone } from './ui/file-drop-zone';
import { DownloadMenu } from './ui/download-menu';
import { FeaturePage } from './ui/feature-page';
import type { RecruitingBrief as RecruitingBriefType } from '@/lib/recruiting-schema';
import type { Survey, SurveyQuestion } from '@/lib/survey-schema';

type GoogleStatus = {
  connected: boolean;
  email: string | null;
  hasResponses: boolean;
  hasDrive: boolean;
};

type PartialSurvey = Partial<Survey> & {
  sections?: Partial<{
    title: string;
    questions: Partial<SurveyQuestion>[];
  }>[];
};

type Criterion = RecruitingBriefType['criteria'][number];

type EditableBrief = {
  summary: string;
  criteria: Criterion[];
  // Schedule is no longer surfaced in the UI but we keep it on the
  // editable brief so the survey-generation prompt still receives the
  // server-extracted timeline as context.
  schedule: RecruitingBriefType['schedule'];
};

const QUESTION_KIND_LABEL: Record<SurveyQuestion['kind'], string> = {
  short_answer: '단답',
  long_answer: '장문',
  single_choice: '단일 선택',
  multi_choice: '복수 선택',
  dropdown: '드롭다운',
  scale: '척도',
};

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';
const ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isCompleteCriterion(
  c: Partial<Criterion>,
): c is Criterion {
  return (
    typeof c.category === 'string' &&
    typeof c.label === 'string' &&
    typeof c.detail === 'string' &&
    typeof c.required === 'boolean'
  );
}

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// One row in the flat survey design table. A choice question with N
// options expands to N rows, each carrying the same question text in
// the first column and the option label in the second. Text/scale
// questions get a single row with empty option.
type SurveyRow = {
  index: number;
  section: string;
  question: string;
  option: string;
  logic: string;
};

function buildSurveyRows(survey: Survey | PartialSurvey | null): SurveyRow[] {
  if (!survey?.sections) return [];
  const rows: SurveyRow[] = [];
  let qIndex = 0;
  for (const section of survey.sections) {
    if (!section) continue;
    const sectionTitle = section.title ?? '';
    for (const q of section.questions ?? []) {
      if (!q || typeof q.title !== 'string') continue;
      qIndex += 1;
      const kind = (q.kind ?? '') as SurveyQuestion['kind'];
      const kindLabel = QUESTION_KIND_LABEL[kind] ?? kind;
      const requiredLabel = q.required ? '필수' : '선택';
      let logic = `${kindLabel} · ${requiredLabel}`;
      if (kind === 'scale') {
        const lo = q.scaleMin ?? 1;
        const hi = q.scaleMax ?? 5;
        const labels =
          q.scaleMinLabel || q.scaleMaxLabel
            ? ` (${q.scaleMinLabel ?? ''} → ${q.scaleMaxLabel ?? ''})`
            : '';
        logic += ` · ${lo}~${hi}${labels}`;
      }
      const opts = q.options ?? [];
      if (opts.length > 0) {
        for (const opt of opts) {
          rows.push({
            index: qIndex,
            section: sectionTitle,
            question: q.title,
            option: opt,
            logic,
          });
        }
      } else {
        rows.push({
          index: qIndex,
          section: sectionTitle,
          question: q.title,
          option: '',
          logic,
        });
      }
    }
  }
  return rows;
}

function buildSurveyCsv(rows: SurveyRow[]): string {
  const header = ['#', '섹션', '질문', '옵션', '로직'];
  const out = [header.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    out.push(
      [String(r.index), r.section, r.question, r.option, r.logic]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  return out.join('\n');
}

async function buildSurveyXlsxBlob(rows: SurveyRow[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [
    ['#', '섹션', '질문', '옵션', '로직'],
    ...rows.map((r) => [r.index, r.section, r.question, r.option, r.logic]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Survey');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function RecruitingBrief() {
  const t = useTranslations('Features');
  const tCommon = useTranslations('Common');
  const requireAuth = useRequireAuth();
  const jobs = useGenerationJobs();
  const workspace = useWorkspace();

  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState('');
  const [rejected, setRejected] = useState<string[]>([]);
  // Streaming partial brief (Anthropic streamObject) — gets replaced by
  // `edited` once the run completes so the user can tweak it inline.
  const [partial, setPartial] = useState<Partial<RecruitingBriefType> | null>(null);
  const [edited, setEdited] = useState<EditableBrief | null>(null);

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [surveyPartial, setSurveyPartial] = useState<PartialSurvey | null>(null);
  const [surveyRunning, setSurveyRunning] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);

  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{
    formId: string;
    responderUri: string;
    editUri: string;
  } | null>(null);
  const [publishVersion, setPublishVersion] = useState(0);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<{ to: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [mailFields, setMailFields] = useState({
    purpose: '',
    target: '',
    method: '1:1 온라인 인터뷰, 60분',
    schedule: '추후 협의',
    location: '온라인 인터뷰',
    incentive: '현금 7만원',
  });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (!g || g === 'connected') return null;
    return g;
  });

  const job = jobs.get('recruiting');
  const running = job.status === 'running';
  const result =
    job.status === 'done' ? (job.result as RecruitingBriefType | null) : null;
  const errorMessage =
    job.status === 'error' ? job.error ?? 'unknown_error' : null;

  // Hydrate the editable brief once the job finishes. We seed during
  // render (React's recommended pattern over a useEffect+setState) by
  // tracking the result identity we've already absorbed; subsequent
  // user edits live in `edited` untouched.
  const [seededFor, setSeededFor] = useState<RecruitingBriefType | null>(null);
  if (result && result !== seededFor) {
    setSeededFor(result);
    setEdited({
      summary: result.summary ?? '',
      criteria: result.criteria.map((c) => ({ ...c })),
      schedule: result.schedule.map((p) => ({ ...p })),
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recruiting/google/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) {
          setGoogle({
            connected: !!j.connected,
            email: j.email ?? null,
            hasResponses: !!j.hasResponses,
            hasDrive: !!j.hasDrive,
          });
        }
      })
      .catch(() => {});
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

  function updateCriterion<K extends keyof Criterion>(
    idx: number,
    field: K,
    value: Criterion[K],
  ) {
    setEdited((prev) => {
      if (!prev) return prev;
      const next = [...prev.criteria];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, criteria: next };
    });
  }
  function removeCriterion(idx: number) {
    setEdited((prev) => {
      if (!prev) return prev;
      return { ...prev, criteria: prev.criteria.filter((_, i) => i !== idx) };
    });
  }
  function addCriterion() {
    setEdited((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        criteria: [
          ...prev.criteria,
          { category: '기타', label: '', detail: '', required: false },
        ],
      };
    });
  }
  async function generateSurvey() {
    if (!edited) return;
    const briefForApi: RecruitingBriefType = {
      summary: edited.summary,
      criteria: edited.criteria,
      schedule: edited.schedule,
    };
    setSurvey(null);
    setSurveyPartial(null);
    setSurveyError(null);
    setPublished(null);
    setSurveyRunning(true);
    track('recruiting_survey_generate_click', { feature: 'recruiting_survey' });
    try {
      const res = await fetch('/api/recruiting/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: briefForApi }),
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
        const parsed = await parsePartialJson(buffer);
        if (parsed.value && typeof parsed.value === 'object') {
          setSurveyPartial(parsed.value as PartialSurvey);
        }
      }
      const finalSurvey = JSON.parse(buffer) as Survey;
      setSurvey(finalSurvey);
      setSurveyPartial(finalSurvey);
      track('recruiting_survey_generate_success', { feature: 'recruiting_survey' });
    } catch (e) {
      setSurveyError(e instanceof Error ? e.message : 'survey_failed');
    } finally {
      setSurveyRunning(false);
    }
  }

  async function publishToGoogle() {
    if (!survey) return;
    setPublishing(true);
    setPublishError(null);
    setStarted(null);
    setStartError(null);
    try {
      const res = await fetch('/api/recruiting/google/forms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ survey }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.error ?? `publish_failed: ${res.statusText}`);
      }
      setPublished(j);
      setPublishVersion((v) => v + 1);
      track('recruiting_publish_success', { feature: 'recruiting_publish' });
      // Register the published form as a workspace artifact so it shows
      // up in the modal and can be assigned to a project. The Google
      // form id is durable across renders, so addArtifact's upsert keeps
      // re-publishes from spamming new rows.
      const formId: string | undefined = j.formId ?? j.form_id;
      if (formId) {
        const md = [
          `# ${survey.title || 'Recruiting form'}`,
          '',
          `- 응답 링크: ${j.responderUri ?? ''}`,
          `- 편집 링크: ${j.editUri ?? ''}`,
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
          id: `recruiting_${formId}`,
          featureKey: 'recruiting',
          title: `${survey.title || 'recruiting'}.md`,
          content: md,
          dbFeature: 'recruiting',
          dbId: formId,
          projectId: activeProjectId,
        });
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'publish_failed');
    } finally {
      setPublishing(false);
    }
  }

  function buildMailBody(uri: string, fields: typeof mailFields) {
    return [
      `목적: ${fields.purpose}`,
      `대상 : ${fields.target}`,
      `방식: ${fields.method}`,
      `일정 : ${fields.schedule}`,
      `장소 : ${fields.location}`,
      `조사 사례 : ${fields.incentive}`,
      `인터뷰 신청서 링크 : ${uri}`,
    ].join('\n');
  }

  // Resilient fetch+json that surfaces a clean error when the server
  // returns HTML (e.g. a 404 page from a deployment that lacks the
  // route, which used to bubble up as a confusing JSON parse error).
  async function safeJson(res: Response): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
    const text = await res.text();
    try {
      return { ok: res.ok, data: JSON.parse(text) as Record<string, unknown>, status: res.status };
    } catch {
      return {
        ok: false,
        data: { error: `non_json_response (${res.status})` },
        status: res.status,
      };
    }
  }

  async function openStartModal() {
    if (!published) return;
    setStartError(null);
    setStarted(null);
    setDraftError(null);
    setStartModalOpen(true);

    if (!edited) return;
    setDraftLoading(true);
    try {
      const res = await fetch('/api/recruiting/start/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief: {
            summary: edited.summary,
            criteria: edited.criteria,
            schedule: edited.schedule,
          },
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok || !data.draft) {
        throw new Error((data.error as string) ?? 'draft_failed');
      }
      const d = data.draft as Partial<typeof mailFields>;
      setMailFields((prev) => ({
        purpose: d.purpose || prev.purpose,
        target: d.target || prev.target,
        method: d.method || prev.method,
        schedule: d.schedule || prev.schedule,
        location: d.location || prev.location,
        incentive: d.incentive || prev.incentive,
      }));
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'draft_failed');
    } finally {
      setDraftLoading(false);
    }
  }

  async function confirmStartRecruiting() {
    if (!published) return;
    setStarting(true);
    setStartError(null);
    try {
      const body = buildMailBody(published.responderUri, mailFields);
      const res = await fetch('/api/recruiting/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responderUri: published.responderUri,
          body,
        }),
      });
      const { ok, data } = await safeJson(res);
      if (!ok) {
        throw new Error((data.error as string) ?? `start_failed: ${res.statusText}`);
      }
      setStarted({ to: (data.to as string) ?? 'lee880728@gmail.com' });
      setStartModalOpen(false);
      track('generate_success', { feature: 'recruiting_start' });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'start_failed');
    } finally {
      setStarting(false);
    }
  }

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
        if (!seen.has(key)) {
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

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    if (files.length === 0 && !pasted.trim()) return;
    track('recruiting_extract_click', {
      feature: 'recruiting',
      file_count: files.length,
      pasted_chars: pasted.length,
    });
    const submittedFiles = files;
    const submittedPaste = pasted;

    setPartial(null);
    setEdited(null);

    await jobs.start<RecruitingBriefType>('recruiting', {
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
            setPartial(parsed.value as Partial<RecruitingBriefType>);
          }
        }

        const finalParsed = JSON.parse(buffer) as RecruitingBriefType;
        setPartial(finalParsed);
        track('recruiting_extract_success', { feature: 'recruiting' });
        return finalParsed;
      },
    });
  }

  const canRun = (files.length > 0 || pasted.trim().length > 0) && !running;
  // While streaming, render the partial; after completion the user
  // edits `edited`. Both shapes share criteria/schedule arrays.
  const previewCriteria = edited
    ? edited.criteria
    : (partial?.criteria ?? []).filter(isCompleteCriterion);
  const summaryText = edited?.summary ?? partial?.summary ?? '';
  const showResultPanel = running || partial || edited;

  const surveyRows = useMemo(
    () => buildSurveyRows(survey ?? surveyPartial),
    [survey, surveyPartial],
  );

  return (
    <FeaturePage
      title={t('recruiting.title')}
      headerRight={t('recruiting.cost')}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex h-[220px] flex-col">
          <label className="mb-2 block text-[12px] font-semibold text-ink-2">
            텍스트 붙여넣기
          </label>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={running}
            placeholder="이메일, 메신저, 브리프 텍스트를 그대로 붙여넣으세요."
            className="flex-1 resize-none border border-line bg-paper px-3 py-2 text-[12.5px] leading-[1.6] text-ink-2 placeholder:text-mute-soft focus:border-ink-2 focus:outline-none disabled:opacity-50 [border-radius:4px]"
          />
        </div>
        <div className="flex h-[220px] flex-col">
          <label className="mb-2 block text-[12px] font-semibold text-ink-2">
            파일 업로드
          </label>
          <FileDropZone
            accept={ACCEPT}
            multiple
            onFiles={(files) => addFiles(files)}
            label="파일을 끌어다 놓거나 클릭해서 업로드"
            helperText=".pdf · .docx · .xlsx · .csv · .txt — 최대 10개, 파일당 25MB"
            className="flex-1 gap-2 px-6"
          />
        </div>
      </div>

      {rejected.length > 0 && (
        <div className="mt-3 text-[11.5px] text-amore">
          허용되지 않은 형식: {rejected.join(', ')}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-5 divide-y divide-line border border-line bg-paper [border-radius:4px]">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]"
            >
              <span className="truncate text-ink-2">{f.name}</span>
              <span className="shrink-0 tabular-nums text-mute-soft">
                {formatBytes(f.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={running}
                className="shrink-0 text-[11.5px] text-mute hover:text-amore disabled:opacity-40"
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {files.length}개 파일 · {pasted.length}자
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : '추출 실행'}
        </button>
      </div>

      {errorMessage && (
        <div className="mt-6 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
          오류: {errorMessage}
        </div>
      )}

      {showResultPanel && (
        <div className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
              {running ? '추출 중…' : '추출 결과'}
            </h2>
            <span className="text-[11px] text-mute-soft">
              인라인 편집 가능 — 수정 후 “설문 생성”을 누르세요
            </span>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.04em] text-mute-soft">
              요약
            </label>
            <textarea
              value={summaryText}
              onChange={(e) =>
                setEdited((prev) =>
                  prev ? { ...prev, summary: e.target.value } : prev,
                )
              }
              disabled={!edited}
              rows={2}
              className="w-full resize-y border border-line-soft bg-paper px-3 py-2 text-[12.5px] leading-[1.6] text-ink-2 focus:border-ink-2 focus:outline-none disabled:opacity-60 [border-radius:4px]"
            />
          </div>

          {/* Fixed-height editable criteria panel. Schedule extraction
              still happens server-side and is forwarded to the survey
              prompt for context, but it is no longer surfaced in the UI
              per product feedback (only criteria need to be editable). */}
          <div className="mt-4 h-[480px]">
            <section className="flex h-full min-h-0 flex-col border border-line bg-paper [border-radius:4px]">
              <header className="flex items-center justify-between border-b border-line-soft px-3 py-2">
                <h3 className="text-[12px] font-semibold text-ink-2">
                  대상자 조건 ({previewCriteria.length})
                </h3>
                {edited && (
                  <button
                    type="button"
                    onClick={addCriterion}
                    className="text-[11px] text-mute hover:text-ink-2"
                  >
                    + 항목 추가
                  </button>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {previewCriteria.length === 0 ? (
                  <EmptyState
                    tone="subtle"
                    title={running ? '분석 중…' : '추출된 조건이 없습니다.'}
                  />
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {previewCriteria.map((c, i) => (
                      <li key={i} className="px-3 py-2 text-[12px]">
                        {edited ? (
                          <CriterionEditor
                            value={c}
                            onChange={(field, value) =>
                              updateCriterion(i, field, value)
                            }
                            onRemove={() => removeCriterion(i)}
                          />
                        ) : (
                          <CriterionStreamingView c={c} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {edited && (
            <div className="mt-10 border-t border-line pt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                  설문 (Google Forms)
                </h2>
                <div className="flex items-center gap-2">
                  {survey && surveyRows.length > 0 && (
                    <DownloadMenu
                      tone="ghost"
                      align="end"
                      items={[
                        {
                          format: 'csv',
                          kind: 'blob',
                          filename: `${survey.title || 'survey'}.csv`,
                          build: () =>
                            new Blob(['﻿' + buildSurveyCsv(surveyRows)], {
                              type: 'text/csv;charset=utf-8',
                            }),
                        },
                        {
                          format: 'xlsx',
                          kind: 'blob',
                          filename: `${survey.title || 'survey'}.xlsx`,
                          build: () => buildSurveyXlsxBlob(surveyRows),
                        },
                      ]}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => requireAuth(() => void generateSurvey())}
                    disabled={surveyRunning}
                    className="border border-ink bg-paper px-4 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-[120ms] hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                  >
                    {surveyRunning
                      ? '생성 중…'
                      : survey
                        ? '재생성'
                        : '설문 생성'}
                  </button>
                  {survey &&
                    (google?.connected ? (
                      published ? (
                        <button
                          type="button"
                          onClick={() => void openStartModal()}
                          disabled={starting}
                          className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                        >
                          {starting ? '메일 발송 중…' : '리크루팅 시작'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void publishToGoogle()}
                          disabled={publishing}
                          className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                        >
                          {publishing ? '발행 중…' : 'Google Forms로 발행'}
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href =
                            '/api/recruiting/google/start';
                        }}
                        className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 [border-radius:4px]"
                      >
                        Google 계정 연결
                      </button>
                    ))}
                </div>
              </div>

              {google && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-mute-soft">
                  <span>
                    {google.connected
                      ? `Google 연결됨${google.email ? ` · ${google.email}` : ''}`
                      : 'Google 미연결 — 발행하려면 먼저 계정을 연결하세요.'}
                  </span>
                  {google.connected ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('Google 연결을 해제할까요? 다른 계정으로 다시 연결할 수 있습니다.')) return;
                        await fetch('/api/recruiting/google/disconnect', { method: 'POST' });
                        window.location.reload();
                      }}
                      className="text-mute underline underline-offset-2 hover:text-amore"
                    >
                      연결 해제
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = '/api/recruiting/google/start';
                      }}
                      className="text-amore underline underline-offset-2"
                    >
                      Google 계정 연결
                    </button>
                  )}
                </p>
              )}
              {google?.connected && !google.hasDrive && (
                <p className="mt-1 text-[11px] text-amore">
                  공개(anyone with link) 권한 부여를 위해 Google 계정을 다시 연결해주세요.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = '/api/recruiting/google/start';
                    }}
                    className="underline underline-offset-2"
                  >
                    재연결
                  </button>
                </p>
              )}
              {surveyError && (
                <div className="mt-4 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
                  설문 생성 오류: {surveyError}
                </div>
              )}
              {publishError && (
                <div className="mt-4 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
                  발행 오류: {publishError}
                </div>
              )}
              {googleAuthError && (
                <div className="mt-4 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
                  Google 연결 오류: {googleAuthError} — 연결 해제 후 다시 시도해주세요.
                </div>
              )}
              {startError && (
                <div className="mt-4 border border-amore bg-amore-bg p-4 text-[12.5px] text-amore [border-radius:4px]">
                  메일 발송 오류: {startError}
                </div>
              )}
              {started && (
                <div className="mt-4 border border-line-soft bg-paper p-4 text-[12.5px] text-ink [border-radius:4px]">
                  리크루팅 메일을 {started.to}로 발송했습니다.
                </div>
              )}
              {published && (
                <div className="mt-4 border border-line-soft bg-paper p-4 text-[12.5px] [border-radius:4px]">
                  <div className="font-semibold text-ink">발행 완료</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
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
                </div>
              )}

              {(surveyRunning || surveyRows.length > 0) && (
                <div className="mt-6">
                  {(surveyPartial?.title || survey?.title) && (
                    <div className="mb-3 text-[13px] font-semibold text-ink">
                      {survey?.title ?? surveyPartial?.title}
                    </div>
                  )}
                  <div className="h-[480px] overflow-auto border border-line bg-paper [border-radius:4px]">
                    <table className="w-full min-w-[760px] border-collapse text-[12px]">
                      <thead className="sticky top-0 z-[1] bg-paper">
                        <tr className="text-left">
                          <th className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2 w-[42px]">
                            #
                          </th>
                          <th className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2 w-[120px]">
                            섹션
                          </th>
                          <th className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2">
                            질문
                          </th>
                          <th className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2">
                            옵션
                          </th>
                          <th className="border-b border-line-soft px-3 py-2 font-semibold text-ink-2 w-[180px]">
                            로직
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveyRows.map((r, i) => {
                          // De-dup the question/section/index/logic
                          // columns: only show them on the first option
                          // row of each question group, blank for the
                          // following option rows.
                          const isFirst =
                            i === 0 || surveyRows[i - 1].index !== r.index;
                          return (
                            <tr key={i} className="align-top">
                              <td className="border-b border-line-soft px-3 py-2 tabular-nums text-mute">
                                {isFirst ? r.index : ''}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 text-mute">
                                {isFirst ? r.section : ''}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 text-ink-2">
                                {isFirst ? r.question : ''}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 text-ink-2">
                                {r.option}
                              </td>
                              <td className="border-b border-line-soft px-3 py-2 text-mute-soft">
                                {isFirst ? r.logic : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {google?.connected && (
        <RecruitingResponses
          publishVersion={publishVersion}
          hasResponsesScope={google.hasResponses}
        />
      )}

      {startModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/50 p-4"
          onClick={() => {
            if (!starting) setStartModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-[640px] border border-line bg-paper p-5 [border-radius:6px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
              리크루팅 메일 발송
              {draftLoading && (
                <span className="text-[11px] font-normal text-mute">
                  · 추출된 조건으로 초안 생성 중…
                </span>
              )}
            </div>
            <div className="mb-4 text-[11.5px] text-mute">
              각 항목을 검토·수정한 뒤 최종 승인하면 lee880728@gmail.com으로 발송됩니다.
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3">
              {(
                [
                  { key: 'purpose', label: '목적', multiline: false },
                  { key: 'target', label: '대상', multiline: true },
                  { key: 'method', label: '방식', multiline: false },
                  { key: 'schedule', label: '일정', multiline: false },
                  { key: 'location', label: '장소', multiline: false },
                  { key: 'incentive', label: '조사 사례', multiline: false },
                ] as const
              ).map(({ key, label, multiline }) => (
                <label key={key} className="block">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-mute">
                    {label}
                  </div>
                  {multiline ? (
                    <textarea
                      value={mailFields[key]}
                      onChange={(e) =>
                        setMailFields((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      rows={2}
                      disabled={draftLoading}
                      className="w-full resize-y border border-line bg-paper px-3 py-2 text-[12.5px] leading-[1.5] text-ink focus:border-ink-2 focus:outline-none disabled:opacity-40 [border-radius:4px]"
                    />
                  ) : (
                    <input
                      type="text"
                      value={mailFields[key]}
                      onChange={(e) =>
                        setMailFields((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      disabled={draftLoading}
                      className="w-full border border-line bg-paper px-3 py-2 text-[12.5px] text-ink focus:border-ink-2 focus:outline-none disabled:opacity-40 [border-radius:4px]"
                    />
                  )}
                </label>
              ))}
              <div className="block">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-mute">
                  인터뷰 신청서 링크 (자동)
                </div>
                <div className="break-all border border-line-soft bg-paper-2 px-3 py-2 text-[11.5px] text-mute [border-radius:4px]">
                  {published?.responderUri ?? ''}
                </div>
              </div>
            </div>

            {draftError && (
              <div className="mb-3 border border-line-soft bg-paper p-3 text-[11.5px] text-mute [border-radius:4px]">
                초안 자동 생성 실패 — 직접 입력해주세요. ({draftError})
              </div>
            )}
            {startError && (
              <div className="mb-3 border border-amore bg-amore-bg p-3 text-[12px] text-amore [border-radius:4px]">
                메일 발송 오류: {startError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStartModalOpen(false)}
                disabled={starting}
                className="border border-line bg-paper px-4 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-[120ms] hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmStartRecruiting()}
                disabled={
                  starting ||
                  draftLoading ||
                  !mailFields.purpose.trim() ||
                  !mailFields.target.trim()
                }
                className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                {starting ? '발송 중…' : '최종 승인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeaturePage>
  );
}

function CriterionStreamingView({ c }: { c: Criterion }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.04em] text-mute-soft">
          {c.category}
        </span>
        <span
          className={
            c.required
              ? 'border border-amore px-1.5 py-px text-[10px] text-amore [border-radius:3px]'
              : 'border border-line px-1.5 py-px text-[10px] text-mute [border-radius:3px]'
          }
        >
          {c.required ? '필수' : '우대'}
        </span>
      </div>
      <div className="mt-1 font-semibold text-ink">{c.label}</div>
      <div className="mt-0.5 text-mute">{c.detail}</div>
    </div>
  );
}

function CriterionEditor({
  value,
  onChange,
  onRemove,
}: {
  value: Criterion;
  onChange: <K extends keyof Criterion>(field: K, val: Criterion[K]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value.category}
          onChange={(e) => onChange('category', e.target.value)}
          placeholder="카테고리"
          className="w-[140px] border border-line-soft bg-paper px-2 py-1 text-[10.5px] uppercase tracking-[0.04em] text-mute-soft focus:border-ink-2 focus:outline-none [border-radius:3px]"
        />
        <label className="flex items-center gap-1 text-[10.5px] text-mute">
          <input
            type="checkbox"
            checked={value.required}
            onChange={(e) => onChange('required', e.target.checked)}
            className="h-3 w-3"
          />
          필수
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-[10.5px] text-mute hover:text-amore"
        >
          삭제
        </button>
      </div>
      <input
        type="text"
        value={value.label}
        onChange={(e) => onChange('label', e.target.value)}
        placeholder="라벨"
        className="w-full border border-line-soft bg-paper px-2 py-1 text-[12px] font-semibold text-ink focus:border-ink-2 focus:outline-none [border-radius:3px]"
      />
      <textarea
        value={value.detail}
        onChange={(e) => onChange('detail', e.target.value)}
        placeholder="세부 설명"
        rows={2}
        className="w-full resize-none border border-line-soft bg-paper px-2 py-1 text-[12px] leading-[1.5] text-mute focus:border-ink-2 focus:outline-none [border-radius:3px]"
      />
    </div>
  );
}

