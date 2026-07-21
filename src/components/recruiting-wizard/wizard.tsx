'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { parsePartialJson } from 'ai';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import { useRequireAuth } from '@/components/auth-provider';
import { useGenerationJobs } from '@/components/generation-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { BrandLoader } from '@/components/ui/brand-loader';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { Field } from '@/components/canvas/shell/field';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey } from '@/lib/survey-schema';
import { applyStandardBlocks } from '@/lib/recruiting/survey-postprocess';
import { isStandardSectionTitle } from '@/lib/recruiting/standard-blocks';
import {
  CriteriaEditor,
  CriteriaPreview,
  SurveyEditor,
  SurveyPreview,
} from './views';
import {
  clearDraft,
  loadDraft,
  persistDraft,
  settleStreamingPhase,
  type EditableBrief,
  type Phase,
} from './draft-storage';

type Criterion = RecruitingBrief['criteria'][number];
type CardError = string | null;

type GoogleStatus = {
  connected: boolean;
  email: string | null;
  hasDrive: boolean;
  // Set when the server has the admin-proxy env populated. In that
  // mode the user never needs to OAuth (every publish goes through
  // chris.lee's refresh token server-side) so the wizard hides the
  // "Google 계정 연결" CTA and the "drive 권한 부족" reconnect hint.
  adminProxy: boolean;
};

type PublishedForm = {
  formId: string;
  responderUri: string;
  sheetUrl: string | null;
};

// Stages we cycle through while the server-side publish chain runs.
// They map roughly onto the three round-trips the create endpoint does
// (form create + items batchUpdate + drive share + linked sheet) but we
// don't have real per-stage signals — the labels are timed UX cues so
// the user sees forward motion instead of a single multi-second spinner.
const PUBLISH_STAGES: { label: string; afterMs: number }[] = [
  { label: 'Google 연결 확인…', afterMs: 0 },
  { label: '구글 설문지 생성 중…', afterMs: 1200 },
  { label: '응답 시트 연결 중…', afterMs: 4500 },
  { label: '발행 마무리 중…', afterMs: 8000 },
];

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.txt';
const ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;
const MAX_FILES = 10;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// 푸터 primary CTA 의 no-op onClick(진행중/비활성) 은 안정 참조.
const NOOP = () => {};

export function RecruitingWizard({
  onPublishedChange,
  onConditionsChange,
}: {
  // Emitted whenever the wizard enters/leaves the published state so the
  // canvas card can mount the shared WidgetStatusFooter ("신청서 제작이
  // 완료되었습니다" → fullview) without prop-drilling internal wizard state.
  onPublishedChange?: (published: boolean) => void;
  // Emitted whenever the analysed 대상자 조건 change so the fullview's
  // conditions panel can mirror them. The criteria live only in this
  // wizard's React state (never persisted per-form server-side), so the
  // fullview reads them by lifting this callback rather than re-fetching.
  onConditionsChange?: (brief: EditableBrief | null) => void;
} = {}) {
  const requireAuth = useRequireAuth();
  const t = useTranslations('Recruiting');
  const jobs = useGenerationJobs();
  const workspace = useWorkspace();
  // 위젯별 동시사용 게이트 (#512) — 추출 시작 시 슬롯 획득, 종료 시 반납.
  const gate = useWidgetGate('recruiting');

  // ── Draft rehydration ───────────────────────────────────────────────
  // Load any sessionStorage draft once on first render so each state
  // slot below can seed from the same snapshot. Cleared in an effect
  // below to keep this read single-use. See draft-storage.ts.
  const [hydrationDraft] = useState(() => loadDraft());

  // ── Card 1: criteria ────────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState(() => hydrationDraft?.pasted ?? '');
  const [rejected, setRejected] = useState<string[]>([]);
  const [criteriaPhase, setCriteriaPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.criteriaPhase) : 'idle',
  );
  const [criteriaError, setCriteriaError] = useState<CardError>(null);
  const [partialBrief, setPartialBrief] = useState<
    Partial<RecruitingBrief> | null
  >(() => hydrationDraft?.partialBrief ?? null);
  const [editedBrief, setEditedBrief] = useState<EditableBrief | null>(
    () => hydrationDraft?.editedBrief ?? null,
  );

  // ── Card 2: survey ──────────────────────────────────────────────────
  const [surveyPhase, setSurveyPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.surveyPhase) : 'idle',
  );
  const [surveyError, setSurveyError] = useState<CardError>(null);
  const [survey, setSurvey] = useState<Survey | null>(
    () => hydrationDraft?.survey ?? null,
  );

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
  const [publishStageIdx, setPublishStageIdx] = useState(0);

  // Surface published ↔ unpublished transitions to the host card so it can
  // render the shared completion footer (fullview entry point).
  useEffect(() => {
    onPublishedChange?.(!!published);
  }, [published, onPublishedChange]);

  // Surface the analysed 대상자 조건 to the host card so the fullview's
  // 조건 요약 panel can render them. null until Card 1 produces a brief.
  useEffect(() => {
    onConditionsChange?.(editedBrief);
  }, [editedBrief, onConditionsChange]);

  // ── Modal state ─────────────────────────────────────────────────────
  type ModalState =
    | { open: false }
    | { open: true; card: 'criteria' | 'survey'; mode: 'preview' | 'editor' };
  const [modal, setModal] = useState<ModalState>({ open: false });

  // 4-step 아코디언 접기(§3 collapsed) — all-open ↔ 요약 4행 토글.
  const [collapsed, setCollapsed] = useState(false);

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
            adminProxy: !!j.adminProxy,
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

  // Drop the persisted draft once its state has been seeded into the
  // wizard above. Idempotent so React 19 strict-mode double-mount is a
  // no-op on the second pass.
  useEffect(() => {
    if (hydrationDraft) clearDraft();
    // hydrationDraft is read once on first render; intentionally
    // omitted from deps so this fires exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot the wizard before any OAuth-driven full-page navigation.
  // Anything not serialisable (uploaded `File[]`) is intentionally
  // omitted — the analysed brief is what matters for resuming work.
  function captureDraft() {
    persistDraft({
      pasted,
      partialBrief,
      editedBrief,
      survey,
      criteriaPhase,
      surveyPhase,
    });
  }

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
    // 슬롯 획득 — 정원 초과면 카드 국소 대기 UI 후 admitted 시 자동 진행.
    const admitted = await gate.acquire();
    if (!admitted) return;
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

    try {
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

        // Stream can end on a partial JSON (LLM token cutoff, upstream
        // abort, empty response). Try strict parse first; on failure fall
        // back to the partial parser, which repairs truncated structures
        // — accept it only if the required arrays are present so we don't
        // hand the UI an empty brief silently.
        const finalParsed = await coerceBrief(buffer);
        setPartialBrief(finalParsed);
        track('recruiting_extract_success', { feature: 'recruiting' });
        return finalParsed;
      },
    });
    } finally {
      // 추출 종료(성공/실패 모두 jobs.start 가 resolve) — 슬롯 반납.
      gate.release();
    }
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
    trackEvent('job_started', {
      widget: 'recruiting',
      job_type: 'form_generate',
    });
    const generateStartedAt = Date.now();

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
      const rawSurvey = await coerceSurvey(buffer);
      // The standard template blocks (인적사항 + 전화번호 + 개인정보 동의)
      // are injected post-LLM so users see the *complete* survey in the
      // Step 2 preview/editor before approving. The LLM no longer generates
      // these, so this is what materialises them; the publish route
      // re-applies the same idempotent post-process as defense in depth.
      const finalSurvey = applyStandardBlocks(rawSurvey);
      setSurvey(finalSurvey);
      setSurveyPhase('review');
      track('recruiting_survey_generate_success', {
        feature: 'recruiting_survey',
      });
      trackEvent('job_completed', {
        widget: 'recruiting',
        job_type: 'form_generate',
        duration_ms: Math.max(0, Date.now() - generateStartedAt),
      });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      trackEvent('job_failed', {
        widget: 'recruiting',
        job_type: 'form_generate',
        error: e instanceof Error ? e.message : 'survey_failed',
      });
      setSurveyError(e instanceof Error ? e.message : 'survey_failed');
      setSurveyPhase('idle');
    } finally {
      if (surveyAbortRef.current === ctrl) surveyAbortRef.current = null;
    }
  }

  function approveSurvey() {
    if (!survey) return;
    setSurveyPhase('approved');
    // The publish chain itself fires from an effect once
    // (surveyPhase === 'approved' && google?.connected && !published) holds,
    // so it also resumes correctly after an OAuth round-trip rehydrates
    // the draft. Trigger the same effect path here by clearing any prior
    // error; the OAuth-not-connected branch still needs to redirect first.
    setPublishError(null);
    // Admin proxy: status already reported connected=true and the
    // server publishes through the admin token. Skip the OAuth detour
    // entirely so the user lands on the spinner immediately.
    if (google && !google.connected && !google?.adminProxy) {
      captureDraft();
      if (typeof window !== 'undefined') {
        window.location.href = '/api/recruiting/google/start';
      }
    }
  }

  function regenerateSurvey() {
    if (!editedBrief) return;
    void doGenerateSurvey(editedBrief);
  }

  // ── Card 3 actions ──────────────────────────────────────────────────
  // The publish chain (Step 2 승인 → OAuth check → Form create → linked
  // Sheet → public link) is auto-started from the effect below once the
  // user has approved AND Google is connected. We expose `autoPublish`
  // as a function so the error block can re-trigger after the user fixes
  // an OAuth issue without re-clicking "승인".
  async function autoPublish() {
    if (!survey) return;
    setPublishing(true);
    setPublishStageIdx(0);
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
        // Persist the analysed 조건/요약 with the form so the fullview
        // 조건 panel can render them for this form after refresh / for
        // any older form (server-side, not just this session's state).
        body: JSON.stringify({
          survey,
          criteria: editedBrief?.criteria,
          summary: editedBrief?.summary,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error ?? `publish_failed: ${res.statusText}`);
      }
      const pub: PublishedForm = {
        formId: j.formId ?? j.form_id,
        responderUri: j.responderUri,
        sheetUrl: j.sheetUrl ?? null,
      };
      setPublished(pub);
      // Refresh the bento-bottom outputs row without waiting for its
      // 30 s poll tick.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('recruiting:published'));
      }
      track('recruiting_publish_success', { feature: 'recruiting_publish' });
      // OBS-1 짝: standardised widget_action for the 발행 leg of the OBS-3
      // 생성→발행→추출 funnel (pairs with the server-side status='published'
      // transition). metadata carries the form_id so PostHog can join a
      // published event to its later extraction_completed event.
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'recruiting_form_published',
        metadata: { form_id: pub.formId },
      });
      // Register the published form as a workspace artifact.
      if (pub.formId) {
        const md = [
          `# ${survey.title || 'Recruiting form'}`,
          '',
          `- 응답 링크: ${pub.responderUri ?? ''}`,
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

  // ── Auto-publish trigger ───────────────────────────────────────────
  // Fires once when Step 2 is approved AND Google is connected AND we
  // haven't published yet. Also covers the OAuth round-trip resume path:
  // captureDraft() persists surveyPhase='approved', the callback rehydrates
  // it, and once /status reports connected this effect kicks off the
  // publish chain without the user re-clicking "승인".
  const triggeredForRef = useRef<Survey | null>(null);
  useEffect(() => {
    if (surveyPhase !== 'approved') return;
    if (!survey) return;
    if (published || publishing) return;
    if (publishError) return; // wait for explicit retry
    if (!google) return; // status still loading
    if (!google.connected) return; // approveSurvey already kicked off OAuth
    if (triggeredForRef.current === survey) return;
    triggeredForRef.current = survey;
    void autoPublish();
    // autoPublish reads survey/state via closure; deps deliberately
    // omit it to avoid re-firing on every state change inside the chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyPhase, survey, published, publishing, publishError, google]);

  // Drive the labeled progress stages while publishing. Cleared when the
  // publish call resolves (publishing=false).
  useEffect(() => {
    if (!publishing) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    PUBLISH_STAGES.forEach((stage, idx) => {
      if (idx === 0) return;
      timers.push(setTimeout(() => setPublishStageIdx(idx), stage.afterMs));
    });
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [publishing]);

  // ── Widget header state pill sync (PR #514 patch) ──────────────────
  // PR #514 (위젯 헤더 state pill — 실시간 갱신) 가 desk/interviews/probing/
  // quotes/translate 5 위젯만 처리해서 recruiting 카드는 헤더 pill 이
  // 'READY' 에 멈춰 있었다. wizard 의 phase 진행 (1단계 → 2단계 → 발행)
  // 을 헤더로 broadcast. 우선순위: error > publishing > surveyPhase
  // generating > criteriaPhase generating > published > idle.
  const { setState: setWidgetState } = useWidgetState();
  useEffect(() => {
    if (publishError || criteriaError || surveyError) {
      const message = publishError ?? criteriaError ?? surveyError ?? undefined;
      setWidgetState({ kind: 'error', message });
      return;
    }
    if (publishing) {
      setWidgetState({ kind: 'running', label: '발행 중' });
      return;
    }
    if (surveyPhase === 'generating') {
      setWidgetState({ kind: 'running', label: '설문 생성' });
      return;
    }
    if (criteriaPhase === 'generating') {
      setWidgetState({ kind: 'running', label: '추출 중' });
      return;
    }
    if (published) {
      setWidgetState({ kind: 'done' });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [
    setWidgetState,
    publishing,
    surveyPhase,
    criteriaPhase,
    publishError,
    criteriaError,
    surveyError,
    published,
  ]);

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

  // ── §3 상태 파생 — 4-step 아코디언 node 상태 + footNote/CTA ──────────
  // CD recruiting BUILD-SPEC §3: 4-step all-open 아코디언. 각 스텝 node 는
  // done(✓ success) / active(ink) / todo(dim). 기존 phase state machine 을
  // 그대로 읽어 매핑만 한다 (로직 회귀 0).
  const stepNode = (i: 1 | 2 | 3 | 4): 'done' | 'active' | 'todo' => {
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

  // footNote — §3 상태별 카드 하단 안내. error > published > ready > open.
  const footNote = anyError
    ? t('setup.footNoteError')
    : published
      ? t('setup.footNotePublished')
      : surveyPhase === 'approved'
        ? t('setup.footNoteReady')
        : t('setup.footNoteOpen');

  // Google 미연결 상태에서 발행 진입 — approveSurvey 의 OAuth 분기와 동일.
  function connectGoogle() {
    captureDraft();
    if (typeof window !== 'undefined') {
      window.location.href = '/api/recruiting/google/start';
    }
  }

  // 단일 primary CTA (푸터 우측) — phase 별 "다음 행동". 진행은 이 CTA 로만
  // 구동(스텝 내부 승인 버튼 중복 제거). published 는 카드-레벨 WidgetStatusFooter
  // 가 응답 보기 핸드오프를 담당한다. CTA 분기는 자식 컴포넌트(SetupFooterCta)로
  // 위임 — 부모 render 에서 객체를 만들지 않아 react-compiler 정합.
  const needsGoogleConnect =
    !!google && !google.connected && !google.adminProxy;

  // ── Render — CD 4-step all-open 아코디언 (recruiting BUILD-SPEC §1/§3) ──
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 콘텐츠 영역 — 콘텐츠 컬럼 max-w 514 (GEOMETRY §3), 4-step 아코디언. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[514px]">
          {/* 접기/펼치기 토글 — §3 open ↔ collapsed. */}
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
                value={t('setup.summarySource', { count: files.length })}
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
                      (n, s) => n + s.questions.length,
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
          {/* STEP 1 — 소스 업로드 (RFP · brief · email) */}
          <SetupStep
            index={1}
            nodeState={stepNode(1)}
            title={t('setup.step1Title')}
          >
            <CriteriaInputFields
              files={files}
              pasted={pasted}
              rejected={rejected}
              running={jobRunning}
              onPasteChange={setPasted}
              onAddFiles={addFiles}
              onRemoveFile={removeFile}
            />
            {criteriaError && (
              <div className="mt-3">
                <ErrorBlock>
                  {t('setup.errorPrefix')}: {criteriaError}
                </ErrorBlock>
              </div>
            )}
          </SetupStep>

          {/* STEP 2 — 참여자 조건 (criteria chips: required=amore / nice=line) */}
          <SetupStep
            index={2}
            nodeState={stepNode(2)}
            title={t('setup.step2Title')}
          >
            {criteriaPhase === 'idle' && (
              <EmptyHint>{t('setup.criteriaEmpty')}</EmptyHint>
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
                  <StepLinks
                    onPreview={() =>
                      setModal({ open: true, card: 'criteria', mode: 'preview' })
                    }
                    onEdit={
                      criteriaPhase === 'approved'
                        ? undefined
                        : () =>
                            setModal({
                              open: true,
                              card: 'criteria',
                              mode: 'editor',
                            })
                    }
                    onRestart={restartCriteria}
                    previewLabel={t('setup.preview')}
                    editLabel={t('setup.edit')}
                    restartLabel={t('setup.restartCriteria')}
                  />
                </div>
              )}
          </SetupStep>

          {/* STEP 3 — 스크리닝 설문 (🔒 locked standard blocks + editable) */}
          <SetupStep
            index={3}
            nodeState={stepNode(3)}
            title={t('setup.step3Title')}
          >
            {stepNode(3) === 'todo' && (
              <EmptyHint>{t('setup.surveyEmpty')}</EmptyHint>
            )}
            {criteriaPhase === 'approved' &&
              (surveyPhase === 'idle' || surveyPhase === 'generating') && (
                <GeneratingRow label={t('setup.generatingSurvey')} />
              )}
            {(surveyPhase === 'review' || surveyPhase === 'approved') &&
              survey && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {survey.sections.map((s, i) => {
                      const locked = isStandardSectionTitle(s.title);
                      const meta = t('setup.surveyQuestionMeta', {
                        count: s.questions.length,
                      });
                      return (
                        <SurveySectionRow
                          key={`${s.title}-${i}`}
                          title={s.title}
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
                  <StepLinks
                    onPreview={() =>
                      setModal({ open: true, card: 'survey', mode: 'preview' })
                    }
                    onEdit={
                      surveyPhase === 'approved'
                        ? undefined
                        : () =>
                            setModal({
                              open: true,
                              card: 'survey',
                              mode: 'editor',
                            })
                    }
                    onRestart={regenerateSurvey}
                    previewLabel={t('setup.preview')}
                    editLabel={t('setup.edit')}
                    restartLabel={t('setup.regenerateSurvey')}
                  />
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

          {/* STEP 4 — Google Form 발행 (info card + 연결/발행/링크) */}
          <SetupStep
            index={4}
            nodeState={stepNode(4)}
            title={t('setup.step4Title')}
            isLast
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-sm border border-line bg-paper-soft px-3.5 py-3 text-md text-mute">
                {t('setup.publishInfo')}
              </div>
              {surveyPhase === 'approved' && (
                <AttendeeReviewPanel
                  google={google}
                  googleAuthError={googleAuthError}
                  publishing={publishing}
                  publishStageLabel={
                    PUBLISH_STAGES[publishStageIdx]?.label ??
                    t('setup.publishing')
                  }
                  published={published}
                  publishError={publishError}
                  onRetry={() => requireAuth(() => void autoPublish())}
                  onConnect={connectGoogle}
                  onReconnect={() => {
                    captureDraft();
                    void reconnectGoogle();
                  }}
                  onClearAuthError={() => setGoogleAuthError(null)}
                />
              )}
            </div>
          </SetupStep>
          </>
          )}
        </div>
      </div>

      {/* 푸터 — footNote(좌, mono) + primary CTA(우, pill). recruiting §1 footer.
          published 는 카드-레벨 WidgetStatusFooter 가 응답 보기 핸드오프 담당. */}
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
          canExtract={canExtract}
          onExtract={startExtract}
          onApproveCriteria={approveCriteria}
          onApproveSurvey={approveSurvey}
          onConnectGoogle={connectGoogle}
        />
      </div>

      {/* Approval modal — shared across steps 2 & 3 (프리뷰/편집) */}
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

// 푸터 primary CTA — phase 별 "다음 행동" 단일 버튼. 부모 render 에서 객체를
// 만들지 않고 여기서 primitive 로 분기(react-compiler 정합). published 는 카드
// 레벨 WidgetStatusFooter 가 응답 보기 핸드오프를 담당하므로 여기선 null.
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
  criteriaPhase: Phase;
  surveyPhase: Phase;
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
    // 승인 후 자동 발행. Google 미연결(비 admin-proxy)이면 연결 CTA.
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
  } else if (criteriaPhase === 'approved' && surveyPhase === 'review' && hasSurvey) {
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

  return (
    <ChromeButton
      variant="primary"
      size="lg"
      onClick={onClick}
      disabled={disabled || busy}
    >
      {label}
    </ChromeButton>
  );
}

// ── CD 4-step 아코디언 셸 (recruiting BUILD-SPEC §1 · GEOMETRY §3) ────────
// 스텝 노드(26px 원) + 세로 레일 + 스텝 타이틀 + 콘텐츠. Probing §1 셸 행과
// 동일 규격(node 26·rail 2px ink/10·title 14.5). node 상태: done(✓ success) /
// active(ink) / todo(dim). 색은 전부 토큰(bg-success/bg-ink/bg-ink 투명도),
// px 는 레이아웃 arbitrary(check:design 제외 대상).
type StepNodeState = 'done' | 'active' | 'todo';

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
      {/* 레일 세로선 — 노드 아래에서 다음 스텝까지. 마지막 스텝은 생략. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[12px] top-[26px] bottom-0 w-[2px] bg-ink/10"
        />
      )}
      {/* 번호 노드 26×26. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-sm font-semibold ${nodeClass}`}
      >
        {nodeState === 'done' ? '✓' : index}
      </span>
      <h3 className="text-xl font-semibold text-ink">{title}</h3>
      <div className="mt-3 mb-6">{children}</div>
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

// screening survey section row — locked(🔒 Standard)=paper-soft tint, editable=
// paper. recruiting §1: `rounded-chrome border-line`(→rounded-sm) / locked=
// proposed:surface-locked(→bg-paper-soft, 보수 매핑 — 토큰-PR defer).
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
      className={`flex items-center gap-2.5 rounded-sm border border-line px-3 py-2.5 ${
        locked ? 'bg-paper-soft' : 'bg-paper'
      }`}
    >
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

// 스텝 상단 안내(todo/empty 상태) — dashed 안내 박스.
function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-line bg-paper-soft px-3 py-3 text-md text-mute-soft">
      {children}
    </div>
  );
}

// 완료된 스텝의 보조 링크(프리뷰/편집/다시). 진행은 푸터 primary CTA 가 구동.
function StepLinks({
  onPreview,
  onEdit,
  onRestart,
  previewLabel,
  editLabel,
  restartLabel,
}: {
  onPreview: () => void;
  onEdit?: () => void;
  onRestart: () => void;
  previewLabel: string;
  editLabel: string;
  restartLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onPreview}>
        {previewLabel}
      </Button>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {editLabel}
        </Button>
      )}
      <Button variant="link" size="xs" onClick={onRestart}>
        {restartLabel}
      </Button>
    </div>
  );
}

// 대상자 조건 입력 필드 (붙여넣기 + 파일 dropzone). 옛 Card 1 상시 노출
// 입력 영역을 서브헤더 "대상자 조건 입력" 버튼이 여는 모달 안으로 이동.
// 추출 CTA (조건 검토) 와 에러는 서브헤더가 소유 — 여기는 입력 필드만.
function CriteriaInputFields({
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
  // 밸런스 튜닝(desk 미러): 넓어진 idle 클러스터(max-w-2xl) 대비 왜소함을
  // 해소하려 필드 세로 간격 gap-4 → gap-5, 두 입력 박스 높이 h-[120px] →
  // h-[140px] 확대 (데스크 controlsForm space-y-5 + 키워드 input 확대와 같은
  // 계열). 이 컴포넌트는 flow-mode 입력 모달(size=md)에도 마운트되지만, 더
  // 커진 입력 박스는 그쪽에서도 무해한 시각 확대일 뿐 기능 회귀는 없다.
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="텍스트 붙여넣기">
          <Textarea
            value={pasted}
            onChange={(e) => onPasteChange(e.target.value)}
            disabled={running}
            placeholder="이메일, 메신저, 브리프 텍스트를 그대로 붙여넣으세요."
            className="h-[140px] resize-none text-md text-ink-2"
          />
        </Field>
        <Field label="파일 업로드">
          <FileDropZone
            accept={ACCEPT}
            multiple
            onFiles={(f) => onAddFiles(f)}
            label="파일을 끌어다 놓거나 클릭"
            helperText=".pdf · .docx · .xlsx · .csv · .txt — 최대 10개"
            className="h-[140px] gap-2 px-6"
          />
        </Field>
      </div>

      {rejected.length > 0 && (
        <div className="text-sm text-warning">
          허용되지 않은 형식: {rejected.join(', ')}
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
                제거
              </Button>
            </li>
          ))}
        </ul>
      )}
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

// Reload glyph for the manual response-count refresh trigger. Stroke
// style matches the app's other inline icons (Gear etc.); spins via a
// caller-passed `animate-spin` while a refresh is in flight.
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

function AttendeeReviewPanel({
  google,
  googleAuthError,
  publishing,
  publishStageLabel,
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
  publishStageLabel: string;
  published: PublishedForm | null;
  publishError: string | null;
  onRetry: () => void;
  onConnect: () => void;
  onReconnect: () => void;
  onClearAuthError: () => void;
}) {
  // Reconnect makes no sense in admin-proxy mode: the user has no
  // OAuth row to reconnect, and the admin token error must be fixed
  // by an operator (rotate refresh token). Force the retry CTA in
  // that mode so the user isn't sent into a /google/start dead-end.
  const needsReauth = isReauthError(publishError) && !google?.adminProxy;
  const [copied, setCopied] = useState(false);

  async function copyResponderUri() {
    if (!published?.responderUri) return;
    try {
      await navigator.clipboard.writeText(published.responderUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API blocked (e.g. permissions-policy in some embeds) —
      // user can still select the input text manually.
    }
  }

  return (
    <div className="space-y-3">
      {publishing ? (
        <GeneratingRow label={publishStageLabel} />
      ) : published ? (
        // Published panel reduced to the attendee link only. Response count /
        // refresh / "모집 현황 보기" / "응답 폼 열기" / "응답 시트 열기" all
        // moved into the card's fullview modal (spec 2026-07-01). The
        // completion signal + fullview entry point is the card-level
        // WidgetStatusFooter, so this panel just hands off the shareable URL.
        <div className="flex flex-wrap items-center gap-2 text-md">
          <span className="shrink-0 text-sm text-mute-soft">참석자용</span>
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
            {copied ? '복사됨' : '복사'}
          </Button>
        </div>
      ) : google && !google.connected && !google.adminProxy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mute-soft">
            Google 계정을 연결하면 설문이 자동으로 발행됩니다.
          </p>
          <Button variant="primary" size="md" onClick={onConnect}>
            Google 계정 연결
          </Button>
        </div>
      ) : publishError ? (
        <div className="border-[2px] border-warning-line bg-warning-bg shadow-[2px_2px_0_var(--color-warning)] p-3 text-md text-ink-2 rounded-sm">
          <div>발행 오류: {publishError}</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {needsReauth ? (
              <>
                <span className="text-sm">
                  Google 토큰이 만료/취소된 것 같습니다. 재연결로 복구하세요.
                </span>
                <Button variant="primary" size="sm" onClick={onReconnect}>
                  Google 재연결
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={onRetry}>
                다시 시도
              </Button>
            )}
          </div>
        </div>
      ) : (
        // google === null (status still loading) → minimal placeholder
        <GeneratingRow label="Google 연결 확인…" />
      )}

      {google?.connected && !google.hasDrive && !google.adminProxy && (
        <p className="text-sm text-amore">
          공개(anyone with link) 권한 부여를 위해 Google 계정을 다시
          연결해주세요.{' '}
          <Button
            variant="link"
            size="xs"
            onClick={onReconnect}
            className="px-0 py-0 font-normal text-sm text-amore underline underline-offset-2 hover:text-amore"
          >
            재연결
          </Button>
        </p>
      )}

      {googleAuthError && (
        <div className="flex items-start justify-between gap-3 border-[2px] border-warning-line bg-warning-bg shadow-[2px_2px_0_var(--color-warning)] p-3 text-md text-ink-2 rounded-sm">
          <span>Google 연결 오류: {googleAuthError}</span>
          <Button
            variant="link"
            size="xs"
            onClick={onClearAuthError}
            className="text-warning"
          >
            닫기
          </Button>
        </div>
      )}
    </div>
  );
}

// When the LLM stream ends with a truncated or empty buffer (token cutoff,
// upstream abort, schema-refusal), strict JSON.parse explodes with
// "Unexpected end of JSON input" — which the user sees as a raw error
// string. Try strict parse, then fall back to the ai SDK's repair-tolerant
// partial parser. Only accept the partial if the shape we need is present.
const STREAM_TRUNCATED_MSG =
  'LLM 응답이 끊겼어요. 입력을 조금 더 구체적으로 넣고 다시 시도해 주세요.';

async function coerceBrief(buffer: string): Promise<RecruitingBrief> {
  if (!buffer.trim()) throw new Error(STREAM_TRUNCATED_MSG);
  try {
    return JSON.parse(buffer) as RecruitingBrief;
  } catch {
    // fall through to partial-parse
  }
  const parsed = await parsePartialJson(buffer);
  const obj =
    parsed.value && typeof parsed.value === 'object'
      ? (parsed.value as Record<string, unknown>)
      : null;
  if (
    obj &&
    Array.isArray(obj.criteria) &&
    Array.isArray(obj.schedule)
  ) {
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      criteria: obj.criteria as RecruitingBrief['criteria'],
      schedule: obj.schedule as RecruitingBrief['schedule'],
    };
  }
  throw new Error(STREAM_TRUNCATED_MSG);
}

async function coerceSurvey(buffer: string): Promise<Survey> {
  if (!buffer.trim()) throw new Error(STREAM_TRUNCATED_MSG);
  try {
    return JSON.parse(buffer) as Survey;
  } catch {
    // fall through
  }
  const parsed = await parsePartialJson(buffer);
  const obj =
    parsed.value && typeof parsed.value === 'object'
      ? (parsed.value as Record<string, unknown>)
      : null;
  if (obj && Array.isArray(obj.sections)) {
    return {
      title: typeof obj.title === 'string' ? obj.title : '',
      description: typeof obj.description === 'string' ? obj.description : '',
      sections: obj.sections as Survey['sections'],
    };
  }
  throw new Error(STREAM_TRUNCATED_MSG);
}

function ErrorBlock({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 border-[2px] border-warning-line bg-warning-bg shadow-[2px_2px_0_var(--color-warning)] p-3 text-md text-ink-2 rounded-sm">
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
