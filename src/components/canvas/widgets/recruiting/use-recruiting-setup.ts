'use client';

/* ────────────────────────────────────────────────────────────────────
   useRecruitingSetup — 리크루팅 세팅 orchestration 훅 (로직 레이어).

   §E fresh-build: 프레젠테이션(setup-accordion.tsx)은 CD .dc.html 대로 신규
   빌드하고, 이 훅이 "재사용 = 로직/데이터" 계약을 담는다. 소스 추출 →
   criteria → 스크리닝 설문 → Google Form 발행의 상태 기계 + 외부 호출을
   캡슐화한다. 재사용: `api/recruiting/*`(extract·survey·google/forms/create·
   google/status·google/start·google/disconnect) · `lib/recruiting/*`
   (applyStandardBlocks) · `draft-storage`(OAuth 왕복 생존) · useGenerationJobs
   · useWidgetGate · useRequireAuth · useWorkspace · useWidgetState · schema.

   프레젠테이션은 이 훅이 돌려주는 state/actions 만 소비 — DOM/클래스는 전혀
   모른다(프레젠테이션 vs 컨테이너 경계).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parsePartialJson } from 'ai';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import { useRequireAuth } from '@/components/auth-provider';
import { useGenerationJobs } from '@/components/generation-job-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey } from '@/lib/survey-schema';
import { applyStandardBlocks } from '@/lib/recruiting/survey-postprocess';
import {
  clearDraft,
  loadDraft,
  persistDraft,
  settleStreamingPhase,
  type EditableBrief,
  type Phase,
} from '@/components/recruiting-wizard/draft-storage';

type Criterion = RecruitingBrief['criteria'][number];

export type GoogleStatus = {
  connected: boolean;
  email: string | null;
  hasDrive: boolean;
  // 서버 admin-proxy env 세팅 시 true — 사용자 OAuth 불필요(모든 발행이
  // 서버 refresh token 경유). "Google 계정 연결" CTA·drive 재연결 힌트 숨김.
  adminProxy: boolean;
};

export type PublishedForm = {
  formId: string;
  responderUri: string;
  sheetUrl: string | null;
};

const ACCEPT_RE = /\.(pdf|docx|xlsx|xls|csv|txt)$/i;
const MAX_FILES = 10;

// LLM 스트림이 truncated/empty 로 끝날 때(token cutoff·abort·거절) strict
// JSON.parse 가 터진다. strict → partial 순으로 시도, 필요한 shape 있을 때만 채택.
// 로직레이어 에러 폴백 메시지(스트림 truncation) — UI 카피 아님.
// i18n-allow-korean -- 로직레이어 에러 폴백(스트림 truncation)
const STREAM_TRUNCATED_MSG = 'LLM 응답이 끊겼어요. 입력을 조금 더 구체적으로 넣고 다시 시도해 주세요.';

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
  if (obj && Array.isArray(obj.criteria) && Array.isArray(obj.schedule)) {
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

// Google refresh token 취소/만료(비밀번호 변경·6개월 미사용·OAuth client 회전)
// 는 서버가 token_refresh_failed / invalid_grant / unauthorized 로 노출. 복구는
// disconnect(stale row 제거) 후 재-OAuth 뿐. substring 매칭(upstream JSON wrap 대비).
export function isReauthError(msg: string | null): boolean {
  if (!msg) return false;
  return /token_refresh_failed|invalid_grant|unauthorized|google_not_connected/i.test(
    msg,
  );
}

async function disconnectGoogle(): Promise<void> {
  try {
    await fetch('/api/recruiting/google/disconnect', { method: 'POST' });
  } catch {
    // best-effort: 로컬 disconnect 실패해도 /google/start 재실행이 token row 덮어씀.
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/api/recruiting/google/start';
  }
}

export type RecruitingSetup = ReturnType<typeof useRecruitingSetup>;

export function useRecruitingSetup({
  onPublishedChange,
  onConditionsChange,
}: {
  onPublishedChange?: (published: boolean) => void;
  onConditionsChange?: (brief: EditableBrief | null) => void;
} = {}) {
  const requireAuth = useRequireAuth();
  const jobs = useGenerationJobs();
  const workspace = useWorkspace();
  const gate = useWidgetGate('recruiting');

  // 최초 1회 sessionStorage draft 로드(OAuth 왕복 생존). 아래 effect 에서 clear.
  const [hydrationDraft] = useState(() => loadDraft());

  // ── 소스 / criteria ──────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState(() => hydrationDraft?.pasted ?? '');
  const [rejected, setRejected] = useState<string[]>([]);
  const [criteriaPhase, setCriteriaPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.criteriaPhase) : 'idle',
  );
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  const [partialBrief, setPartialBrief] = useState<
    Partial<RecruitingBrief> | null
  >(() => hydrationDraft?.partialBrief ?? null);
  const [editedBrief, setEditedBrief] = useState<EditableBrief | null>(
    () => hydrationDraft?.editedBrief ?? null,
  );

  // ── 스크리닝 설문 ────────────────────────────────────────────────
  const [surveyPhase, setSurveyPhase] = useState<Phase>(() =>
    hydrationDraft ? settleStreamingPhase(hydrationDraft.surveyPhase) : 'idle',
  );
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(
    () => hydrationDraft?.survey ?? null,
  );

  // ── Google Form 발행 ─────────────────────────────────────────────
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

  // published ↔ unpublished 를 호스트 카드로 노출(완료 푸터 = fullview 진입).
  useEffect(() => {
    onPublishedChange?.(!!published);
  }, [published, onPublishedChange]);

  // 분석된 대상자 조건을 호스트로 노출(fullview 조건 패널 미러). null until 추출.
  useEffect(() => {
    onConditionsChange?.(editedBrief);
  }, [editedBrief, onConditionsChange]);

  // Google 연결 상태 — 발행 스텝 affordance.
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
    // OAuth 콜백 파라미터가 URL 바에 남지 않게 ?google=... strip.
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

  // seed 된 draft 를 위 state 로 흡수한 뒤 draft 제거(1회). strict-mode 이중
  // 마운트에 idempotent.
  useEffect(() => {
    if (hydrationDraft) clearDraft();
    // hydrationDraft 는 첫 render 1회 읽음 — deps 의도적 생략.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OAuth 전면 네비게이션 전 wizard 스냅샷. 직렬화 불가(File[])는 생략 —
  // 분석된 brief 가 재개 핵심.
  const captureDraft = useCallback(() => {
    persistDraft({
      pasted,
      partialBrief,
      editedBrief,
      survey,
      criteriaPhase,
      surveyPhase,
    });
  }, [pasted, partialBrief, editedBrief, survey, criteriaPhase, surveyPhase]);

  // jobs() 가 추출 done 을 보고하면 editable brief seed. source 결과 identity 를
  // 추적해 사용자 편집 후 재-seed 방지(render-conditional setState 패턴).
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

  // job-level 에러를 흡수(seededFor 미러 패턴 — effect 없이).
  const currentJobError =
    job.status === 'error' ? (job.error ?? 'extract_failed') : null;
  const [absorbedJobError, setAbsorbedJobError] = useState<string | null>(null);
  if (currentJobError !== absorbedJobError) {
    setAbsorbedJobError(currentJobError);
    if (currentJobError) {
      setCriteriaPhase('idle');
      setCriteriaError(currentJobError);
    }
  }

  // ── 파일 핸들링 ──────────────────────────────────────────────────
  const addFiles = useCallback((incoming: FileList | File[]) => {
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
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── criteria 추출 ────────────────────────────────────────────────
  const doExtract = useCallback(async () => {
    if (files.length === 0 && !pasted.trim()) return;
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

          const finalParsed = await coerceBrief(buffer);
          setPartialBrief(finalParsed);
          track('recruiting_extract_success', { feature: 'recruiting' });
          return finalParsed;
        },
      });
    } finally {
      gate.release();
    }
  }, [files, pasted, gate, jobs]);

  const startExtract = useCallback(() => {
    requireAuth(() => void doExtract());
  }, [requireAuth, doExtract]);

  const restartCriteria = useCallback(() => {
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
  }, []);

  // ── 설문 생성 ────────────────────────────────────────────────────
  const surveyAbortRef = useRef<AbortController | null>(null);

  const doGenerateSurvey = useCallback(async (brief: EditableBrief) => {
    surveyAbortRef.current?.abort();
    const ctrl = new AbortController();
    surveyAbortRef.current = ctrl;

    setSurveyPhase('generating');
    setSurveyError(null);
    setSurvey(null);
    setPublished(null);
    setPublishError(null);
    track('recruiting_survey_generate_click', { feature: 'recruiting_survey' });
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
      // 표준 블록(인적사항 + 전화 + 개인정보 동의)은 post-LLM 주입 — 사용자가
      // 승인 前 완성된 설문을 본다. 발행 route 도 동일 idempotent post-process 재적용.
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
  }, []);

  const approveCriteria = useCallback(() => {
    if (!editedBrief) return;
    setCriteriaPhase('approved');
    void doGenerateSurvey(editedBrief);
  }, [editedBrief, doGenerateSurvey]);

  const regenerateSurvey = useCallback(() => {
    if (!editedBrief) return;
    void doGenerateSurvey(editedBrief);
  }, [editedBrief, doGenerateSurvey]);

  // ── Google 연결 / 발행 ───────────────────────────────────────────
  const connectGoogle = useCallback(() => {
    captureDraft();
    if (typeof window !== 'undefined') {
      window.location.href = '/api/recruiting/google/start';
    }
  }, [captureDraft]);

  const reconnectGoogle = useCallback(() => {
    captureDraft();
    void disconnectGoogle();
  }, [captureDraft]);

  const approveSurvey = useCallback(() => {
    if (!survey) return;
    setSurveyPhase('approved');
    setPublishError(null);
    // 발행 체인은 아래 effect 가 (approved ∧ connected ∧ !published) 에서 1회
    // 발화 — OAuth 왕복 재개도 커버. admin-proxy 는 서버 토큰이라 OAuth 우회.
    if (google && !google.connected && !google?.adminProxy) {
      captureDraft();
      if (typeof window !== 'undefined') {
        window.location.href = '/api/recruiting/google/start';
      }
    }
  }, [survey, google, captureDraft]);

  const autoPublish = useCallback(async () => {
    if (!survey) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch('/api/recruiting/google/forms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 분석된 조건/요약을 폼과 함께 저장 — fullview 조건 패널이 refresh /
        // 옛 폼에서도 서버사이드로 렌더.
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('recruiting:published'));
      }
      track('recruiting_publish_success', { feature: 'recruiting_publish' });
      trackEvent('widget_action', {
        widget: 'recruiting',
        action: 'recruiting_form_published',
        metadata: { form_id: pub.formId },
      });
      if (pub.formId) {
        const md = [
          `# ${survey.title || 'Recruiting form'}`,
          '',
          // i18n-allow-korean -- workspace artifact 마크다운 데이터(사용자 UI 아님)
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
        // i18n-allow-korean -- 로직레이어 타임아웃 에러 폴백(UI 카피 아님)
        setPublishError('publish_timeout: 45초 내에 응답이 없습니다. 다시 시도해 주세요.');
      } else {
        setPublishError(e instanceof Error ? e.message : 'publish_failed');
      }
    } finally {
      setPublishing(false);
    }
  }, [survey, editedBrief, workspace]);

  const retryPublish = useCallback(() => {
    requireAuth(() => void autoPublish());
  }, [requireAuth, autoPublish]);

  // 승인 ∧ 연결됨 ∧ 미발행 에서 1회 발행 체인 발화(OAuth 재개 경로 포함).
  const triggeredForRef = useRef<Survey | null>(null);
  useEffect(() => {
    if (surveyPhase !== 'approved') return;
    if (!survey) return;
    if (published || publishing) return;
    if (publishError) return; // 명시 재시도 대기
    if (!google) return; // 상태 로딩 중
    if (!google.connected) return; // approveSurvey 가 OAuth 개시
    if (triggeredForRef.current === survey) return;
    triggeredForRef.current = survey;
    void autoPublish();
    // autoPublish 는 closure 로 state 를 읽음 — 체인 내 매 state 변경 재발화 방지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyPhase, survey, published, publishing, publishError, google]);

  // 위젯 헤더 state pill 동기화는 프레젠테이션(setup-accordion)이 소유 —
  // i18n 라벨을 쓰기 위해(로직 훅엔 하드코딩 문자열 0). 이 훅은 raw phase/
  // error 만 노출한다.

  // ── 파생값 ───────────────────────────────────────────────────────
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

  return {
    // 소스 입력
    files,
    pasted,
    rejected,
    setPasted,
    addFiles,
    removeFile,
    // criteria
    criteriaPhase,
    criteriaError,
    editedBrief,
    partialCriteria,
    startExtract,
    approveCriteria,
    restartCriteria,
    // 설문
    surveyPhase,
    surveyError,
    survey,
    approveSurvey,
    regenerateSurvey,
    // google / 발행
    google,
    googleAuthError,
    clearGoogleAuthError: () => setGoogleAuthError(null),
    publishing,
    published,
    publishError,
    retryPublish,
    connectGoogle,
    reconnectGoogle,
    // 파생
    canExtract,
    jobRunning,
  };
}
