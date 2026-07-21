'use client';

/* ────────────────────────────────────────────────────────────────────
   useDeskWidget — 데스크 리서치 위젯의 로직/데이터 레이어 (CD 파일럿 #2).

   WIDGET-SHELL §AUTHORITY §D: 프레젠테이션은 CD .dc.html 대로 fresh 신규
   빌드하고, **로직/데이터만 재사용**한다. 이 훅이 그 재사용 경계 — 옛
   desk-card-body 의 검증된 상태머신·제출·배너 판정·fullview 배선을 프레젠테이션
   무관하게 캡슐화한다(로직 무변경, presentation-free). 새 CD 프레젠테이션
   컴포넌트(desk-setup-body 등)가 이 훅을 소비한다.

   재사용 자산: `desk-job-provider`(useDeskJobs) · `api/desk/*` · `lib/desk-*`
   · `useProjectSelection` · `useFullview`. 신규 백엔드 0.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import { useRequireAuth } from '@/components/auth-provider';
import { useCreditDeduction } from '@/components/credit-deduction-provider';
import { useWidgetGate } from '@/components/widget-gate-provider';
import { useProjectSelection } from '@/components/project-selection-provider';
import { FEATURE_COSTS } from '@/lib/features';
import { useDeskJobs, type DeskJob } from '@/components/desk-job-provider';
import {
  TREND_SOURCE_IDS,
  type DeskMode,
  type DeskCountryScope,
} from '@/lib/desk-orchestrator/types';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { deskCumulativeProgress } from '@/lib/widget-progress';
import { triggerBlobDownload } from '@/lib/export/download';
import { buildArtifactBaseName } from '@/lib/filename';
import { prefillKey } from '@/lib/workspace';
import { DESK_REGIONS, type DeskRegion } from '@/lib/desk-sources';

function readActiveProjectId(): string | null {
  try {
    const raw = window.localStorage.getItem('active_project:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string } | null;
    return parsed?.id ?? null;
  } catch {
    return null;
  }
}

export type RangePreset =
  | 'all'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'three_years'
  | 'custom';

const RANGE_PRESETS: { id: RangePreset; days: number | null }[] = [
  { id: 'all', days: null },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'quarter', days: 90 },
  { id: 'year', days: 365 },
  { id: 'three_years', days: 1095 },
  { id: 'custom', days: null },
];

export function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n\t、·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Fullview 상단 "이전 산출물" 드롭다운 option 라벨.
export function deskJobSelectorLabel(job: DeskJob): string {
  const title = job.keywords.length > 0 ? job.keywords.join(', ') : '(키워드 없음)';
  const d = new Date(job.created_at);
  const date = Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
  const status =
    job.status === 'done'
      ? ''
      : job.status === 'error'
        ? ' — 에러'
        : job.status === 'cancelled'
          ? ' — 취소됨'
          : ' — 진행중';
  return date ? `${title} (${date})${status}` : `${title}${status}`;
}

export function useDeskWidget() {
  const tDesk = useTranslations('Desk');
  const locale = useLocale();
  const requireAuth = useRequireAuth();
  const { jobs, latestJob, isWorking, cancelJob, hydrateJob } = useDeskJobs();
  const { notify: notifyDeduction } = useCreditDeduction();
  const gate = useWidgetGate('desk');
  const { getSelection, setSelection } = useProjectSelection();
  const projectId = getSelection('desk');

  // ─── inputs ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<DeskMode>('trend');
  const [countryScope, setCountryScope] = useState<DeskCountryScope>('kr');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [regions, setRegions] = useState<Set<DeskRegion>>(() => new Set(['KR']));

  const [submitting, setSubmitting] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [forceControls, setForceControls] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { renderInSlot, openFullview, close: closeFullview } = useFullview('desk');

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const fullviewJob =
    jobs.find((j) => j.id === selectedJobId) ??
    latestJob ??
    jobs.find((j) => j.status === 'done') ??
    null;
  const fullviewJobId = fullviewJob?.id ?? null;
  const fullviewNeedsHydration =
    fullviewJob?.status === 'done' && fullviewJob.output === undefined;
  const [hydrationFailedId, setHydrationFailedId] = useState<string | null>(null);
  const fullviewHydrationFailed =
    fullviewNeedsHydration && hydrationFailedId === fullviewJobId;
  useEffect(() => {
    if (!fullviewJobId || !fullviewNeedsHydration) return;
    let cancelled = false;
    void hydrateJob(fullviewJobId).then((ok) => {
      if (!cancelled && !ok) setHydrationFailedId(fullviewJobId);
    });
    return () => {
      cancelled = true;
    };
  }, [fullviewJobId, fullviewNeedsHydration, hydrateJob]);

  const handleDeskFullview = () => {
    trackEvent('widget_action', { widget: 'desk', action: 'fullview_open' });
    trackEvent('widget_viewed', { widget: 'desk', fullview: true });
    openFullview();
  };

  function retryHydration() {
    if (!fullviewJobId) return;
    setHydrationFailedId(null);
    void hydrateJob(fullviewJobId).then((ok) => {
      if (!ok) setHydrationFailedId(fullviewJobId);
    });
  }

  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'desk' });
  }, []);

  function pushKeywords(parts: string[]) {
    if (parts.length === 0) return;
    setKeywords((prev) => {
      const seen = new Set(prev);
      const out = [...prev];
      for (const p of parts) {
        if (!p || seen.has(p)) continue;
        if (out.length >= 10) break;
        out.push(p);
        seen.add(p);
      }
      return out;
    });
  }

  // Workspace "send to" prefill.
  useEffect(() => {
    try {
      const k = prefillKey('desk');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount prefill from sessionStorage (workspace send-to)
      pushKeywords(splitKeywords(raw));
    } catch {}
  }, []);

  // ─── submit ──────────────────────────────────────────────────────────
  function onClickRun() {
    requireAuth(() => void doSubmit());
  }
  async function doSubmit() {
    const finalKeywords = keywords;
    if (finalKeywords.length === 0) {
      setError(tDesk('errorNoKeyword'));
      return;
    }
    const admitted = await gate.acquire();
    if (!admitted) return;
    setSubmitting(true);
    setError(null);
    setForceControls(false);
    track('desk_generate_click', {
      feature: 'desk',
      kw_count: finalKeywords.length,
    });
    trackEvent('job_started', {
      widget: 'desk',
      job_type: 'search',
      cost_credits: FEATURE_COSTS.desk,
    });
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: finalKeywords,
          mode,
          country_scope: countryScope,
          locale: locale === 'ko' ? 'ko' : 'en',
          regions: Array.from(regions),
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          project_id: projectId ?? readActiveProjectId(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        setSubmitting(false);
        return;
      }
      track('desk_generate_success', { feature: 'desk', job_id: json.job_id });
      notifyDeduction('desk', FEATURE_COSTS.desk);
      if (typeof json.job_id === 'string') {
        setPendingJobId(json.job_id);
      } else {
        setSubmitting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!pendingJobId) return;
    if (latestJob?.id === pendingJobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to external/prop/ref change
      setPendingJobId(null);
      setSubmitting(false);
      return;
    }
    const t = setTimeout(() => {
      setPendingJobId(null);
      setSubmitting(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [pendingJobId, latestJob?.id]);

  // ─── current job + thinking panel ──────────────────────────────────────
  const job: DeskJob | null = latestJob;
  const events = useMemo(
    () => job?.progress?.events ?? [],
    [job?.progress?.events],
  );
  const showStream = !!job && (isWorking || events.length > 0);

  // ─── stuck watchdog ────────────────────────────────────────────────────
  const STUCK_THRESHOLD_MS = 150_000;
  const STUCK_CANCEL_HINT_MS = STUCK_THRESHOLD_MS;
  const [now, setNow] = useState(() => Date.now());
  const eventCountRef = useRef<number>(0);
  const lastEventAtRef = useRef<number>(Date.now());
  const watchedJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (watchedJobIdRef.current !== (job?.id ?? null)) {
      watchedJobIdRef.current = job?.id ?? null;
      eventCountRef.current = events.length;
      lastEventAtRef.current = Date.now();
      return;
    }
    if (events.length !== eventCountRef.current) {
      eventCountRef.current = events.length;
      lastEventAtRef.current = Date.now();
    }
  }, [job?.id, events.length]);
  useEffect(() => {
    if (!isWorking) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [isWorking]);
  const stuckMs = isWorking ? now - lastEventAtRef.current : 0;
  const isStuck = isWorking && stuckMs > STUCK_THRESHOLD_MS;
  const stuckBodyText = (() => {
    if (stuckMs >= STUCK_CANCEL_HINT_MS) return tDesk('stuckBodyLong');
    switch (job?.progress?.phase) {
      case 'crawling':
        return tDesk('stuckBodyCrawling');
      case 'summarizing':
        return tDesk('stuckBodySynthesizing');
      default:
        return tDesk('stuckBodyDefault');
    }
  })();
  const showStuckCancel = stuckMs >= STUCK_CANCEL_HINT_MS;

  // ─── stage timing chips ────────────────────────────────────────────────
  const PHASE_ORDER = useMemo(
    () =>
      [
        ['expanding', '키워드 확장'],
        ['crawling', '크롤'],
        ['summarizing', '요약'],
        ['analytics', '차트'],
      ] as const,
    [],
  );
  const timings = job?.progress?.timings;
  const timingChips = timings
    ? PHASE_ORDER.flatMap(([key, label]) => {
        const ms = timings[`${key}_ms` as keyof typeof timings];
        if (!ms || ms < 50) return [];
        const sec = ms >= 10_000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1);
        return [{ key, label, text: `${label} ${sec}s` }];
      })
    : [];
  const elapsedSec = job?.progress?.elapsed_ms
    ? Math.round(job.progress.elapsed_ms / 1000)
    : null;
  const skippedSteps = job?.progress?.skipped_steps ?? null;

  const doneEmpty =
    job?.status === 'done' && (!job.output || job.output.trim().length < 100);
  const isTimeoutError =
    job?.status === 'error' &&
    (job.error_message?.startsWith('budget_exceeded') ?? false);
  const isFallbackReport =
    job?.status === 'done' &&
    (job.output?.startsWith('# 데스크 리서치 보고서 (약식)') ?? false);
  const isRawDump =
    job?.status === 'done' &&
    (job.output?.startsWith('# 📊 데스크 리서치 결과 — Raw Data') ?? false);

  function onClickRetry() {
    setError(null);
    requireAuth(() => void doSubmit());
  }

  // ─── download ──────────────────────────────────────────────────────────
  function buildFilename(): string {
    return buildArtifactBaseName({
      prefix: 'desk',
      slug: job?.keywords[0],
      createdAt: job?.created_at ?? new Date(),
    });
  }
  async function downloadDocx(markdown: string) {
    setExporting(true);
    track('desk_export_docx_click', { feature: 'desk', format: 'docx' });
    try {
      const filename = buildFilename();
      const res = await fetch('/api/desk/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          markdown,
          filename,
          title: job?.keywords?.length
            ? `데스크 리서치 — ${job.keywords.join(', ')}`
            : '데스크 리서치',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? res.statusText);
        return;
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, `${filename}.docx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export_failed');
    } finally {
      setExporting(false);
    }
  }

  const hasKeywords = keywords.length > 0;
  const canRun = !submitting && !pendingJobId && !isWorking && hasKeywords;

  // ── input-time scope estimate ──
  const kwCountForEstimate = keywords.length;
  const effectiveKwForEstimate = kwCountForEstimate <= 1 ? 5 : kwCountForEstimate;
  const estimateSourceCount = TREND_SOURCE_IDS.length;
  const estimatedSearches = hasKeywords
    ? effectiveKwForEstimate *
      Math.max(estimateSourceCount, 1) *
      Math.max(regions.size, 1)
    : 0;
  const estimateHeavy = estimatedSearches >= 60;
  const showResult = !!(job?.status === 'done' && job.output);

  // ─── widget shell state pill ───────────────────────────────────────────
  const { setState: setWidgetState } = useWidgetState();
  useEffect(() => {
    if (submitting || pendingJobId) {
      setWidgetState({ kind: 'running', label: 'SUBMITTING' });
      return;
    }
    if (isWorking && job) {
      const phase = job.progress?.phase;
      const label = phase ? phase.toUpperCase() : 'RUNNING';
      const crawlTotal = job.progress?.crawl_total ?? 0;
      const crawlDone = job.progress?.crawl_done ?? 0;
      const progress =
        crawlTotal > 0
          ? Math.min(99, Math.round((crawlDone / crawlTotal) * 100))
          : undefined;
      const overallProgress = Math.min(
        99,
        deskCumulativeProgress({
          phase,
          crawl_done: crawlDone,
          crawl_total: crawlTotal,
        }),
      );
      setWidgetState({ kind: 'running', label, progress, overallProgress });
      return;
    }
    if (job?.status === 'error') {
      setWidgetState({ kind: 'error', message: job.error_message ?? undefined });
      return;
    }
    if (job?.status === 'done') {
      setWidgetState({ kind: 'done' });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [setWidgetState, submitting, pendingJobId, isWorking, job]);

  // ─── job-terminal analytics + gate release ─────────────────────────────
  const deskJobIdRef = useRef<string | null>(null);
  const deskJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const prev = deskJobIdRef.current === job.id ? deskJobStatusRef.current : null;
    deskJobIdRef.current = job.id;
    deskJobStatusRef.current = job.status;
    if (!prev || prev === job.status) return;
    if (
      job.status === 'done' ||
      job.status === 'error' ||
      job.status === 'cancelled'
    ) {
      gate.release();
    }
    if (job.status === 'done') {
      trackEvent('job_completed', {
        widget: 'desk',
        job_type: 'search',
        duration_ms: job.progress?.elapsed_ms ?? 0,
      });
    } else if (job.status === 'error') {
      trackEvent('job_failed', {
        widget: 'desk',
        job_type: 'search',
        error: job.error_message ?? 'unknown_error',
      });
    }
  }, [job, gate]);

  const rangePresets = RANGE_PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
    label: tDesk(`range_${p.id}` as const),
    days: p.id === 'all' ? null : p.days,
  }));

  const active = submitting || !!pendingJobId || isWorking || !!job;
  const deskRunning = submitting || !!pendingJobId || isWorking;

  return {
    // inputs
    mode,
    setMode,
    countryScope,
    setCountryScope,
    keywords,
    setKeywords,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    regions,
    setRegions,
    projectId,
    setProject: (id: string | null) => setSelection('desk', id),
    rangePresets,
    locale,
    // derived
    hasKeywords,
    canRun,
    active,
    deskRunning,
    showResult,
    forceControls,
    setForceControls,
    estimate: {
      kw: effectiveKwForEstimate,
      src: Math.max(estimateSourceCount, 1),
      region: Math.max(regions.size, 1),
      count: estimatedSearches,
      heavy: estimateHeavy,
    },
    // job + progress
    job,
    isWorking,
    submitting,
    pendingJobId,
    events,
    showStream,
    isStuck,
    stuckBodyText,
    showStuckCancel,
    timingChips,
    elapsedSec,
    skippedSteps,
    doneEmpty,
    isTimeoutError,
    isFallbackReport,
    isRawDump,
    error,
    // actions
    onClickRun,
    onClickRetry,
    cancelJob,
    handleDeskFullview,
    // fullview / export
    jobs,
    fullviewJob,
    selectedJobId,
    setSelectedJobId,
    fullviewNeedsHydration,
    fullviewHydrationFailed,
    retryHydration,
    previewOpen,
    setPreviewOpen,
    exporting,
    downloadDocx,
    buildFilename,
    renderInSlot,
    closeFullview,
    // constants
    DESK_REGIONS,
  };
}

export type DeskWidget = ReturnType<typeof useDeskWidget>;
