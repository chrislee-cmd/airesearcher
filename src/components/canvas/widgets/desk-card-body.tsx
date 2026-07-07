'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { track } from '@/components/mixpanel-provider';
import { track as trackEvent } from '@/lib/analytics/events';
import { useRequireAuth } from '@/components/auth-provider';
import { useCreditDeduction } from '@/components/credit-deduction-provider';
import { FEATURE_COSTS } from '@/lib/features';

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
import {
  useDeskJobs,
  type DeskJob,
} from '@/components/desk-job-provider';
import { DeskResultView } from '@/components/canvas/widgets/desk-result';
import {
  TREND_SOURCE_IDS,
  type DeskMode,
} from '@/lib/desk-orchestrator/types';
import { Select } from '@/components/ui/select';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { JobProgress } from '@/components/ui/job-progress';
import {
  ProcessTimeline,
  buildLinearPhases,
} from '@/components/ui/process-timeline';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { IconButton } from '@/components/ui/icon-button';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { ChipInput } from '@/components/ui/chip-input';
import { DateRangePopover } from '@/components/ui/date-range-popover';
import { SelectMenu } from '@/components/ui/select-menu';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { Field } from '@/components/canvas/shell/field';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetStatusFooter } from '@/components/canvas/shell/widget-status-footer';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { deskCumulativeProgress } from '@/lib/widget-progress';
import { Banner } from '@/components/canvas/shell/banner';
import { triggerBlobDownload } from '@/lib/export/download';
import { buildArtifactBaseName } from '@/lib/filename';
import { prefillKey } from '@/lib/workspace';
import {
  DESK_REGIONS,
  type DeskRegion,
} from '@/lib/desk-sources';

type RangePreset =
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

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n\t、·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 데스크 세부 옵션 trigger (지역 SelectMenu · 기간 DateRangePopover) 공유 규격
// — 밸런스 튜닝 h-10 확정값을 한 곳에서 소유해 두 trigger 가 같은 행에서
// 높이·보더·폰트 완전 동일하도록 정합. 공유 primitive
// (ui/select-menu) 의 SIZE 맵을 건드리지 않고 로컬 상수로 두는 이유 = "데스크
// 단독" 제약(타 위젯 영향 0). 세 곳 복붙 대신 이 상수를 buttonClassName /
// trigger className 으로 공유한다. 규격 자체는 위젯 전역 공용 primitive
// (ui/control-trigger 의 CONTROL_TRIGGER_CLASS) 로 승격 — 전사록/리크루팅/통역
// DropdownMenu trigger 와도 h-10/보더/chevron 완전 정합 (드롭다운 통일 spec).
const DESK_OPTION_TRIGGER_CLASS = CONTROL_TRIGGER_CLASS;

// Fullview 상단 "이전 산출물" 드롭다운의 option 라벨 — 리크루팅 응답
// fullview 의 selectorLabel(제목 (날짜)) 패턴에 status 접미사만 추가.
// 미완료 job 도 목록에 남기되 라벨로 구분해 클릭 전에 알 수 있게 한다.
function deskJobSelectorLabel(job: DeskJob): string {
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

export function DeskCardBody() {
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const tWidgets = useTranslations('Widgets');
  const tProcess = useTranslations('Process');
  const locale = useLocale();
  const requireAuth = useRequireAuth();
  const { jobs, latestJob, isWorking, cancelJob } = useDeskJobs();
  const { notify: notifyDeduction } = useCreditDeduction();

  // ─── inputs ──────────────────────────────────────────────────────────────
  // 리서치 목적 mode (데스크 v2). 기본 = 트렌드 — 목적 기반 flow 가 v2 의
  // 주 경로. trend / market 모두 서버가 소스를 목적 기반으로 자동 선정한다
  // (옛 소스 직접 선택 custom mode 는 제거됨).
  const [mode, setMode] = useState<DeskMode>('trend');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  // 사용자 자유 텍스트 — LLM 분석 시 어떤 관점으로 정리할지 hint. 현재
  // 백엔드 wiring 없음 (zod schema / DB column 미존재) — 후속 PR 에서
  // /api/desk POST body 에 `user_intent` 로 추가 + prompts 에 inject 예정.
  const [analysisDirection, setAnalysisDirection] = useState<string>('');
  // 멀티 region 선택 — 최소 1개 보장 (모두 해제 X, API 가 region 을 필요로 함).
  const [regions, setRegions] = useState<Set<DeskRegion>>(
    () => new Set(['KR']),
  );

  // region 갱신은 SelectMenu onChange 콜백에서 직접 처리 (다중 선택 + 최소
  // 1개 보장 inline). 소스는 mode 별로 서버가 자동 선정한다.

  const [submitting, setSubmitting] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  // 완료(done) 상태에서 "새 리서치" 를 눌러 컨트롤 폼을 다시 노출하기 위한
  // 로컬 플래그. active 시 컨트롤+CTA 가 타임라인으로 대체되므로(사용자 결정
  // R2), 완료 후 재실행 경로를 잃지 않도록 done 블록에 새 리서치 CTA 를 둔다.
  const [forceControls, setForceControls] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // 통일 "전체 보기" — 가장 최근 완료 리포트를 풀스크린으로. 공유 모달
  // (CanvasBoard FullviewShell)이 소유하고, desk 가 currentKey 일 때만 본문을
  // 모달 slot 으로 portal. 결과는 useDeskJobs provider 기반이라 모달 close 후
  // 에도 보존. 행별 "미리보기" 모달(previewOpen) 과는 별개 — 그건 그대로 유지.
  const { renderInSlot, openFullview, close: closeFullview } = useFullview('desk');

  // Fullview 좌측 "이전 산출물" 사이드바에서 고른 job. 카드 본문(latestJob,
  // 세션 스코프)은 그대로 두고 fullview 우측 report 만 스위치한다. Default =
  // latestJob (신 job 자동 노출) → 없으면 가장 최근 done job (fresh 세션에서
  // navigator 로 fullview 진입 시 옛 완료 산출물이 바로 보이도록 — 이
  // sidebar 의 존재 이유).
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const fullviewJob =
    jobs.find((j) => j.id === selectedJobId) ??
    latestJob ??
    jobs.find((j) => j.status === 'done' && j.output) ??
    null;

  // 통일 "전체 보기" 진입 계측 — 표준 이벤트 (spec analytics 6/6).
  const handleDeskFullview = () => {
    trackEvent('widget_action', { widget: 'desk', action: 'fullview_open' });
    trackEvent('widget_viewed', { widget: 'desk', fullview: true });
    openFullview();
  };

  // Analytics — 카드 body mount 시 1회 view.
  useEffect(() => {
    trackEvent('widget_viewed', { widget: 'desk' });
  }, []);

  // Receive workspace "send to" prefills — splits the artifact text the
  // same way the paste/keydown handlers do so a list of keywords (or a
  // comma/newline-separated blob) lands as ready-to-run keyword chips.
  useEffect(() => {
    try {
      const k = prefillKey('desk');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      pushKeywords(splitKeywords(raw));
    } catch {}

  }, []);

  // ─── keyword tag input ────────────────────────────────────────────────────
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
  function removeKeyword(idx: number) {
    setKeywords(keywords.filter((_, i) => i !== idx));
  }
  function commitDraft(raw?: string): string[] {
    const source = raw ?? keywordDraft;
    const parts = splitKeywords(source);
    pushKeywords(parts);
    setKeywordDraft('');
    const seen = new Set(keywords);
    const merged = [...keywords];
    for (const p of parts) {
      if (!p || seen.has(p)) continue;
      if (merged.length >= 10) break;
      merged.push(p);
      seen.add(p);
    }
    return merged;
  }
  function onKeywordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (keywordDraft.trim()) {
        e.preventDefault();
        commitDraft();
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !keywordDraft && keywords.length) {
      setKeywords(keywords.slice(0, -1));
    }
  }
  function onKeywordPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (/[,\n\t、·]/.test(pasted)) {
      e.preventDefault();
      const merged = (keywordDraft + pasted).trim();
      const parts = splitKeywords(merged);
      pushKeywords(parts);
      setKeywordDraft('');
    }
  }

  // ─── submit ──────────────────────────────────────────────────────────────
  function onClickRun() {
    requireAuth(() => void doSubmit());
  }
  async function doSubmit() {
    // market mode = 실 로직 구현 완료 (market PR) — 이제 trend 와 동일하게
    // 서버가 소스를 자동 선정하고 TAM/SAM 참고 데이터를 생성한다. shell 이
    // 남겨 둔 '곧 제공' 실행 차단은 이 PR 에서 해제한다.
    const finalKeywords = commitDraft();
    if (finalKeywords.length === 0) {
      setError(tDesk('errorNoKeyword'));
      return;
    }
    setSubmitting(true);
    setError(null);
    setForceControls(false);
    track('desk_generate_click', { feature: 'desk', kw_count: finalKeywords.length });
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
          // trend / market 모두 서버가 소스를 목적 기반으로 자동 선정한다.
          locale: locale === 'ko' ? 'ko' : 'en',
          regions: Array.from(regions),
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          project_id: readActiveProjectId(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        setSubmitting(false);
        return;
      }
      track('desk_generate_success', { feature: 'desk', job_id: json.job_id });
      // 차감 broadcast — 위젯 헤더 -N fly-up + topbar pulse.
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

  // ─── current job + thinking panel ──────────────────────────────────────────
  const job: DeskJob | null = latestJob;
  const events = useMemo(() => job?.progress?.events ?? [], [job?.progress?.events]);
  const showStream = !!job && (isWorking || events.length > 0);
  const thoughtsScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thoughtsScroller.current) {
      thoughtsScroller.current.scrollTop = thoughtsScroller.current.scrollHeight;
    }
  }, [events.length]);

  // ─── stuck watchdog ──────────────────────────────────────────────────────
  // "한없이 기다리는" 상황 차단 — events 가 STUCK_THRESHOLD_MS 동안 늘지
  // 않으면 부드러운 info banner 노출. drafting (Sonnet 3-pass × RQ 직렬) ·
  // synthesizing 같은 정상 LLM 호출은 자연스럽게 60~120s silent 구간이
  // 생기므로 45s → 150s 로 상향 — 정상 작업 중 false-positive "응답 없음"
  // 으로 cancel 을 유도하던 사고 fix. 진짜 사고는 server-side budget timeout
  // (300s + 자동 환불) 이 자체 정리하므로 client 자동 cancel 은 제거.
  const STUCK_THRESHOLD_MS = 150_000; // 2.5분 — drafting 한 RQ 호출 평균보다 안전
  const STUCK_CANCEL_HINT_MS = 270_000; // 4.5분 — 명시 cancel 버튼 노출 (자동 cancel 0)
  const [now, setNow] = useState(() => Date.now());
  const eventCountRef = useRef<number>(0);
  const lastEventAtRef = useRef<number>(Date.now());
  const watchedJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the watchdog timer whenever the watched job changes (new run)
    // or a new event arrives on the same job.
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

  // 자동 cancel 제거 — 정상 LLM 호출 (drafting 등) 을 강제 종료하던 사고
  // 방지. 진짜 사고는 server-side budget timeout (300s + 자동 환불) 이
  // 자체 정리하고, 4.5분+ 면 아래 banner 가 명시 cancel 버튼을 노출한다.

  // 부드러운 안내 문구 — 현재 phase 에 맞춰 "지금 무슨 무거운 작업을
  // 하는 중인지" 알려 사용자 패닉을 차단. 4.5분+ 면 더 오래 걸린다는
  // 안내 + cancel 유도 톤으로 전환.
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

  // ─── stage timing chips ──────────────────────────────────────────────────
  // Each closed phase records elapsed ms in progress.timings — surface them
  // as a chip row so users (and admins eyeballing screenshots) can spot the
  // bottleneck without opening Vercel logs.
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
  // Done but the report body never arrived — a server-side write succeeded
  // for status but synthesize quietly missed. Surface as a hard failure so
  // the user retries instead of staring at an empty card.
  const doneEmpty =
    job?.status === 'done' && (!job.output || job.output.trim().length < 100);
  // Tag for the timeout error path so the banner reads as "시간 초과
  // (자동 환불)" instead of dumping the raw message.
  const isTimeoutError =
    job?.status === 'error' &&
    (job.error_message?.startsWith('budget_exceeded') ?? false);
  // Server fell back to deterministic markdown (synthesize timeout/fail).
  // Detect via the marker the fallback builder writes at the top of output.
  const isFallbackReport =
    job?.status === 'done' &&
    (job.output?.startsWith('# 데스크 리서치 보고서 (약식)') ?? false);
  // Server ran out of budget after crawl and emitted a deterministic raw-data
  // dump (0 LLM). Detected via the marker the dump builder writes at the top.
  const isRawDump =
    job?.status === 'done' &&
    (job.output?.startsWith('# 📊 데스크 리서치 결과 — Raw Data') ?? false);

  function onClickRetry() {
    setError(null);
    requireAuth(() => void doSubmit());
  }

  // ─── download ──────────────────────────────────────────────────────────────
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

  const hasKeywords = keywords.length > 0 || keywordDraft.trim().length > 0;
  // trend / market 모두 서버가 소스를 자동 선정하므로 키워드만 있으면 실행 가능.
  const canRun =
    !submitting && !pendingJobId && !isWorking && hasKeywords;
  // ── Input-time scope estimate (spec-down §F) ──────────────────────────────
  // Rough "약 N회 검색" so the user can shrink scope before a heavy run that
  // would only yield a raw-data dump. A single keyword expands to +4 similar
  // server-side, so treat 1 keyword as 5. The product (kw × sources × regions)
  // is an upper bound — region-only-aware sources don't truly multiply by
  // regions — but it tracks the crawl cap math closely enough for guidance.
  const kwCountForEstimate = keywords.length + (keywordDraft.trim() ? 1 : 0);
  const effectiveKwForEstimate = kwCountForEstimate <= 1 ? 5 : kwCountForEstimate;
  // trend / market 은 서버 자동 선정 소스 수 기준 (trend 의 부정 filter 나
  // market 의 소스 세트 차이는 소량이라 견적에선 trend 소스 수로 근사).
  const estimateSourceCount = TREND_SOURCE_IDS.length;
  const estimatedSearches = hasKeywords
    ? effectiveKwForEstimate *
      Math.max(estimateSourceCount, 1) *
      Math.max(regions.size, 1)
    : 0;
  const estimateHeavy = estimatedSearches >= 60;
  const showResult = !!(job?.status === 'done' && job.output);

  // 헤더 pill 로 push 할 live state. 우선순위:
  //   1) submitting/pendingJob → running ('SUBMITTING', progress 없음)
  //   2) isWorking → running, label = phase, progress = crawl_done/crawl_total
  //   3) job?.status === 'error' → error (+ message)
  //   4) job?.status === 'done' → done
  //   5) 그 외 → idle
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
      // overallProgress: 6 단계 누적 % (Navigator 용). per-step progress 와
      // 별도 — 위젯 헤더 pill 은 phase 안 진행도, Navigator 는 전체 완성도.
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
      setWidgetState({
        kind: 'error',
        message: job.error_message ?? undefined,
      });
      return;
    }
    if (job?.status === 'done') {
      setWidgetState({ kind: 'done' });
      return;
    }
    setWidgetState({ kind: 'idle' });
  }, [
    setWidgetState,
    submitting,
    pendingJobId,
    isWorking,
    job,
  ]);
  // cardState 는 widget shell 외부에서 결정 (PR2 시점에는 widget meta.state
  // 가 'idle' 로 고정 — 후속 PR 에서 widget shell 로 live state 주입 검토).

  // Analytics — job 종료(완료/실패) 시 1회 발화. prev status 를 잡별로
  // 추적해 실제 전이만 계측 — 마운트 시점의 historical done/error 잡은
  // prev 가 없어 발화하지 않는다 (새로고침 false-positive 방지).
  const deskJobIdRef = useRef<string | null>(null);
  const deskJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const prev = deskJobIdRef.current === job.id ? deskJobStatusRef.current : null;
    deskJobIdRef.current = job.id;
    deskJobStatusRef.current = job.status;
    if (!prev || prev === job.status) return;
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
  }, [job]);

  // 수집 기간 quick-pick — RANGE_PRESETS 를 popover preset 형태로 매핑.
  // 'custom' 은 캘린더 직접 선택이라 quick-pick 에서 제외. 'all' 은 days=null
  // (범위 해제) 로.
  const rangePresets = RANGE_PRESETS.filter((p) => p.id !== 'custom').map(
    (p) => ({
      label: tDesk(`range_${p.id}` as const),
      days: p.id === 'all' ? null : p.days,
    }),
  );

  // ─── active (산출물 영역 노출 여부) ────────────────────────────────────────
  // 컨트롤 패널은 phase 무관 항상 노출된다. `active` 는 그 아래 산출물 영역
  // (스트리밍/배너/타이밍/상태 푸터) 렌더 여부만 가른다: 제출/진행중이거나
  // job(결과/에러/취소)이 존재하면 true. 결과가 남아 있으면 계속 유지 —
  // false 로 자동 복귀 안 함 (결정 2). 실행 중에도 컨트롤은 그대로라 값 조정
  // 후 재실행 가능 (결정 3).
  const active = submitting || !!pendingJobId || isWorking || !!job;

  // ─── 공정 과정 타임라인 (사용자 결정 R2/R3) ────────────────────────────────
  // 진행 중(deskRunning)이면 컨트롤+CTA 자리를 멀티-라인 타임라인이 대체하고,
  // 완료(showResult)면 "완료됐어요! + 전체 보기" 블록이 대체한다. 데스크는
  // 유일하게 세분화된 progress.phase 를 노출해 단일-잡 타임라인에 잘 맞는다.
  const deskRunning = submitting || !!pendingJobId || isWorking;
  const DESK_TIMELINE_PHASES = [
    'expanding',
    'scoping',
    'crawling',
    'extracting',
    'drafting',
    'critiquing',
    'synthesizing',
    'summarizing',
  ] as const;
  const deskTimelinePhases = buildLinearPhases(
    DESK_TIMELINE_PHASES.map((k) => ({
      key: k,
      label: tProcess(`desk.${k}` as never),
      detail:
        k === 'crawling'
          ? `${job?.progress?.crawl_done ?? 0}/${job?.progress?.crawl_total ?? 0}`
          : undefined,
    })),
    // phase 미보고(제출 직후/queued)면 첫 단계를 active 로 — 빈 타임라인 회피.
    job?.progress?.phase ?? (deskRunning ? 'expanding' : null),
    { allDone: job?.status === 'done' },
  );

  // 로컬 error state (제출 전/제출 실패) 배너 — phase 무관하게 노출해야
  // idle 로 되돌아간 실패도 사용자가 본다.
  const errorBanner = error ? (
    <Banner tone="warning" title={tDesk('error')}>
      <span className="font-mono">{error}</span>
    </Banner>
  ) : null;

  // 컨트롤 폼 — idle 보드 + active slim bar 확장 시 공유. 주제·키워드 입력,
  // 세부 옵션(지역/기간/분석 방향성), 범위 견적, 실행 CTA.
  // 리서치 목적 2 mode 카드 — 라디오 2개 모두 enabled + 실행 가능. `soon`
  // 배지는 아직 미구현 mode 를 위한 자리로 남겨 두되, 현재 2 mode 는 모두
  // 라이브라 아무도 켜지 않는다. (custom mode 는 제거됨.)
  const MODE_OPTIONS: { key: DeskMode; icon: string; soon?: boolean }[] = [
    { key: 'trend', icon: '🔥' },
    { key: 'market', icon: '📊' },
  ];
  const modeSelector = (
    <div role="radiogroup" aria-label={tDesk('modeLabel')} className="grid grid-cols-2 gap-2">
      {MODE_OPTIONS.map((opt) => {
        const isSelected = mode === opt.key;
        return (
          /* eslint-disable-next-line react/forbid-elements -- mode radio
             card: bespoke icon+title+desc toggle surface, Button primitive
             variant 로 표현 불가. */
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => setMode(opt.key)}
            title={tDesk(`modeDesc.${opt.key}` as never)}
            className={
              'relative flex flex-col items-center gap-1.5 rounded-sm border-[2px] p-3 text-center transition-colors ' +
              (isSelected
                ? 'border-amore bg-amore-bg'
                : 'border-line-soft bg-paper hover:bg-paper-soft')
            }
          >
            {isSelected && (
              <span aria-hidden className="absolute right-2 top-2 text-amore">
                ✓
              </span>
            )}
            <span aria-hidden className="text-xl leading-none">
              {opt.icon}
            </span>
            <span className="text-sm font-semibold text-ink">
              {tDesk(`modeTitle.${opt.key}` as never)}
            </span>
            {opt.soon ? (
              <span className="rounded-pill border border-line bg-white px-2 py-0.5 text-xs text-mute">
                {tDesk('modeSoonBadge')}
              </span>
            ) : (
              <span className="line-clamp-2 text-xs leading-[1.5] text-mute">
                {tDesk(`modeDesc.${opt.key}` as never)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const controlsForm = (
    <div className="space-y-5">
      {/* 리서치 목적 — 3 mode selector (데스크 v2) */}
      <Field label={tDesk('modeLabel')}>{modeSelector}</Field>

      {/* 주제 · 키워드 (핵심 입력) */}
      <Field label={tDesk('boardTopicLabel')}>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-[2px] border-ink bg-paper px-3 py-2.5 min-h-[52px] focus-within:border-amore">
          {keywords.map((k, idx) => (
            <span
              key={`${k}-${idx}`}
              className="inline-flex items-center gap-1 rounded-pill border border-amore bg-white px-2.5 py-0.5 text-xs text-amore"
            >
              {k}
              <IconButton
                variant="ghost-brand"
                onClick={() => removeKeyword(idx)}
                aria-label={`remove ${k}`}
              >
                ×
              </IconButton>
            </span>
          ))}
          <ChipInput
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onKeyDown={onKeywordKeyDown}
            onPaste={onKeywordPaste}
            onBlur={() => {
              if (keywordDraft.trim()) commitDraft();
            }}
            placeholder={
              keywords.length === 0
                ? tDesk('keywordPlaceholder')
                : tDesk('keywordAddMore')
            }
            className="min-w-[140px] flex-1"
          />
        </div>
      </Field>

      {/* 세부 옵션 — 지역 / 기간 / 분석 방향성.
          밸런스 튜닝(desk 예시): 3 필드 높이를 h-8 → h-10 으로 확대해 넓어진
          클러스터(max-w-2xl) 대비 왜소함을 해소. SelectMenu/DateRangePopover 는
          공유 primitive 라 SIZE 맵을 건드리지 않고 buttonClassName 로컬
          오버라이드로 데스크 안에서만 키운다 (타 위젯 영향 0 = "데스크 단독"
          제약). 최종 px 는 preview 로 조정 (spec 결정 3). */}
      <Field label={tDesk('boardOptionsLabel')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectMenu
            multi
            options={DESK_REGIONS.map((r) => ({
              value: r,
              label: tDesk(`region.${r}`),
            }))}
            value={Array.from(regions)}
            onChange={(next) => {
              if (next.length === 0) return; // 최소 1개 보장
              // region 은 카테고리→소스 가시성만 좁힌다(카테고리 선택은 유지).
              setRegions(new Set(next as DeskRegion[]));
            }}
            placeholder={tDesk('regionLabel')}
            buttonClassName={DESK_OPTION_TRIGGER_CLASS}
          />

          <DateRangePopover
            value={{ from: dateFrom, to: dateTo }}
            onChange={(next) => {
              setDateFrom(next.from);
              setDateTo(next.to);
            }}
            presets={rangePresets}
            placeholder={tDesk('range_all')}
            locale={locale}
            buttonClassName={DESK_OPTION_TRIGGER_CLASS}
          />

          <Input
            size="sm"
            fullWidth
            className="h-10"
            value={analysisDirection}
            onChange={(e) => setAnalysisDirection(e.target.value)}
            placeholder="예: 시장 성장률 + 주요 플레이어 위주"
          />
        </div>
      </Field>

      {/* 수집 소스 — trend / market 모두 서버가 목적 기반으로 자동 선정한다.
          trend 는 어떤 소스가 쓰이는지 안내 문구만 노출. */}
      {mode === 'trend' && (
        <p className="text-xs leading-[1.6] text-mute-soft">
          {tDesk('modeTrendSourcesHint')}
        </p>
      )}

      {/* Scope estimate — heavy 범위면 warning 톤 + 줄이기 유도. market 은
          실행 차단 상태라 견적 비노출. */}
      {hasKeywords && mode !== 'market' && (
        <p
          className={`text-xs leading-[1.6] ${
            estimateHeavy ? 'text-amore' : 'text-mute-soft'
          }`}
        >
          {tDesk('estimateLabel', {
            kw: effectiveKwForEstimate,
            src: Math.max(estimateSourceCount, 1),
            region: Math.max(regions.size, 1),
            count: estimatedSearches,
          })}
          {' · '}
          {estimateHeavy ? tDesk('estimateHeavy') : tDesk('estimateOk')}
        </p>
      )}

      {/* 실행 CTA 는 WidgetPrimaryCta (우측 중앙 고정 앵커) 로 이동 — 6 위젯
          주 CTA 통일. body root(relative) 에 anchor 되므로 컨트롤 폼 안에는
          더 이상 두지 않는다. 라벨은 데스크 리포트 산출이라 "검색" 유지. */}
    </div>
  );

  return (
    <>
      {/* 본문 — chrome 과 헤더는 widget-shell 책임. 서브헤더 slim bar 폐기:
          컨트롤 패널(주제·키워드 + 옵션 + 실행 CTA)을 phase 무관 상단에 항상
          노출하고, 산출물(스트리밍/배너/타이밍/상태 푸터)은 그 아래 별 영역에
          active 시만 렌더. 산출물 상세는 "전체 보기" modal 로 일원화. */}
      <div className="flex h-full flex-col">
        {/* 컨트롤 패널 — 실행 중에도 값 조정 후 재실행이 가능하도록 항상 노출.
            idle(산출물 없음) 에는 카드 정중앙(수직+수평 center)에 띄워 통일
            launcher 룩. active 진입 시 상단 고정 + 아래 산출물. */}
        <ControlBoardPanel active={active}>
          {deskRunning ? (
              // active: 컨트롤+CTA 완전 대체 → 공정 과정 타임라인.
              <ProcessTimeline phases={deskTimelinePhases} />
            ) : showResult && !forceControls ? (
              // done: "완료됐어요! + 전체 보기" (+ 재실행용 새 리서치).
              <div className="flex flex-col items-center gap-6 py-8">
                <p className="text-lg font-semibold text-ink-2">
                  ✅ {tProcess('completeTitle')}
                </p>
                <div className="flex items-center gap-3">
                  <ChromeButton
                    variant="default"
                    size="lg"
                    onClick={handleDeskFullview}
                  >
                    {tWidgets('viewAll')}
                  </ChromeButton>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForceControls(true)}
                  >
                    {tProcess('newResearch')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {controlsForm}
                {errorBanner}
              </>
            )}
        </ControlBoardPanel>

        {/* 산출물 영역 — active(제출/진행/결과 존재) 일 때만. */}
        {active && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Streaming panel — running 또는 events 있을 때 */}
        {showStream && (
          <div className="border-t border-line-soft bg-paper px-5 py-5">
            {isWorking ? (
              <JobProgress
                value={
                  job?.progress?.crawl_total
                    ? Math.round(
                        ((job.progress.crawl_done ?? 0) /
                          job.progress.crawl_total) *
                          100,
                      )
                    : undefined
                }
                label={(() => {
                  const phase = job?.progress?.phase;
                  if (phase) {
                    try {
                      return tDesk(`phaseLabel.${phase}` as never);
                    } catch {
                      return tDesk('thinkingActive');
                    }
                  }
                  return tDesk('thinkingActive');
                })()}
                hint={
                  job?.progress?.crawl_total
                    ? `${job.progress.crawl_done ?? 0}/${job.progress.crawl_total}`
                    : undefined
                }
                onCancel={
                  job
                    ? job.cancel_requested
                      ? undefined
                      : () => void cancelJob(job.id)
                    : undefined
                }
                cancelLabel={
                  job?.cancel_requested ? tDesk('stopRequested') : tDesk('stop')
                }
              />
            ) : (
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>{tDesk('thinkingDone')}</SectionLabel>
                <span className="text-xs text-mute-soft">{events.length} 이벤트</span>
              </div>
            )}
            <div
              ref={thoughtsScroller}
              className="mt-2 h-[240px] overflow-y-auto rounded-xs border border-line bg-white px-4 py-3 text-md leading-[1.7]"
            >
              {events.map((line, i) => (
                <div key={i} className="py-0.5 text-ink-2">
                  <span className="mr-2 text-amore">›</span>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* cancelled / stuck / done-empty banners — fail 표시 강제.
            (로컬 error state 배너는 errorBanner 로 상단에서 phase 무관 노출) */}
        {/* stuck (active 인데 progress 가 150s 멈춤) — 정상 LLM 호출도 이
            구간에 들 수 있어 alarm 대신 부드러운 info 톤 + phase 별 안내.
            자동 cancel 은 없음. 4.5분(STUCK_CANCEL_HINT_MS)+ 면 더 오래
            걸린다는 안내와 함께 명시 cancel 버튼을 노출 — 사용자 클릭만. */}
        {isStuck && job && (
          <Banner tone="info" title={tDesk('stuckTitle')}>
            <div className="flex flex-wrap items-center gap-3">
              <span>{stuckBodyText}</span>
              {stuckMs >= STUCK_CANCEL_HINT_MS && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void cancelJob(job.id)}
                  disabled={job.cancel_requested}
                >
                  {job.cancel_requested
                    ? tDesk('stopRequested')
                    : tDesk('stopAndRefund')}
                </Button>
              )}
            </div>
          </Banner>
        )}
        {/* status='error' — 무조건 빨간 banner + 재시도 버튼. 사용자가 한없이
            기다리지 않게 budget_exceeded / runtime_error / scoping_failed
            모두 동일 패턴. */}
        {job?.status === 'error' && (
          <Banner
            tone="warning"
            title={isTimeoutError ? tDesk('timeoutTitle') : tDesk('errorTitle')}
          >
            <span>
              {isTimeoutError
                ? tDesk('timeoutBody')
                : job.error_message ?? tDesk('errorBody')}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={onClickRetry}
              disabled={!hasKeywords || submitting || !!pendingJobId}
              className="ml-2 uppercase tracking-[0.18em]"
            >
              {tDesk('retry')}
            </Button>
          </Banner>
        )}
        {/* fallback report — server 가 LLM 합성 실패 후 deterministic
            markdown 으로 약식 보고서를 만든 케이스. 사용자가 결과는 받지만
            한 줄 안내로 "약식이라는 사실" 을 명시. */}
        {isFallbackReport && (
          <Banner tone="info" title={tDesk('fallbackTitle')}>
            <span>{tDesk('fallbackBody')}</span>
            <Button
              variant="link"
              size="sm"
              onClick={onClickRetry}
              disabled={!hasKeywords || submitting || !!pendingJobId}
              className="ml-2 uppercase tracking-[0.18em]"
            >
              {tDesk('retry')}
            </Button>
          </Banner>
        )}
        {/* raw-data dump — 시간 제약으로 AI 분석을 못 돌리고 수집 원자료만
            보고서로 받은 케이스. 결과(기사 목록)는 있으니 warning 이 아닌
            info 톤 + "범위 줄여 재시도" 유도. */}
        {isRawDump && (
          <Banner tone="info" title={tDesk('rawDumpTitle')}>
            <span>{tDesk('rawDumpBody')}</span>
            <Button
              variant="link"
              size="sm"
              onClick={onClickRetry}
              disabled={!hasKeywords || submitting || !!pendingJobId}
              className="ml-2 uppercase tracking-[0.18em]"
            >
              {tDesk('retry')}
            </Button>
          </Banner>
        )}
        {/* status='done' 이지만 output 이 비어있는 케이스 — server 가 catch
            를 못 돈 silent fail. fail 표시 + 재시도 유도. */}
        {doneEmpty && (
          <Banner tone="warning" title={tDesk('doneEmptyTitle')}>
            <span>{tDesk('doneEmptyBody')}</span>
            <Button
              variant="link"
              size="sm"
              onClick={onClickRetry}
              disabled={!hasKeywords || submitting || !!pendingJobId}
              className="ml-2 uppercase tracking-[0.18em]"
            >
              {tDesk('retry')}
            </Button>
          </Banner>
        )}
        {job?.status === 'cancelled' && (
          <div className="border-t border-line-soft px-5 py-5">
            <EmptyState tone="subtle" title={tDesk('cancelledNotice')} />
          </div>
        )}
        {/* 단계별 timing chips — running 중에도 누적 표시 (완료 단계만).
            "지금 어디서 시간 먹는지" 사용자가 알 수 있게. */}
        {timingChips.length > 0 && (
          <div className="border-t border-line-soft bg-paper px-5 py-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-[.18em] text-mute-soft">
              <span>{tDesk('timingsLabel')}</span>
              {elapsedSec != null && (
                <span className="tabular-nums normal-case tracking-normal">
                  {tDesk('elapsedLabel')} {elapsedSec}s
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {timingChips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center rounded-pill border border-line bg-white px-2 py-0.5 text-xs text-mute"
                >
                  {c.text}
                </span>
              ))}
              {skippedSteps?.map((s) => (
                <span
                  key={`skip-${s}`}
                  className="inline-flex items-center rounded-pill border border-warning-line bg-warning-bg px-2 py-0.5 text-xs text-ink-2"
                >
                  {tDesk('skippedChipPrefix')} {s}
                </span>
              ))}
            </div>
          </div>
        )}
            </div>

            {/* 상태 푸터 — 리서치 진행중이면 "리서치가 진행중", 완료 리포트가
                있으면 "리서치가 완료되었습니다"(클릭 → fullview). 진행중 우선.
                리포트는 단건이라 count 배지 없음. */}
            {(() => {
              const running = submitting || !!pendingJobId || isWorking;
              if (running) {
                return (
                  <WidgetStatusFooter
                    status="running"
                    label={tWidgets('deskRunning')}
                    viewAllLabel={tWidgets('viewAll')}
                    resetKey="running"
                    onClick={handleDeskFullview}
                  />
                );
              }
              // done: 상단 완료 블록이 이미 "전체 보기" CTA 를 제공하므로,
              // 컨트롤을 다시 띄운(새 리서치) 경우에만 하단 완료 푸터를 노출.
              if (showResult && forceControls) {
                return (
                  <WidgetStatusFooter
                    status="done"
                    label={tWidgets('deskDone')}
                    viewAllLabel={tWidgets('viewAll')}
                    resetKey={`done-${job?.id ?? ''}`}
                    onClick={handleDeskFullview}
                  />
                );
              }
              return null;
            })()}
          </>
        )}
        {/* 주 CTA — 바디 최하단 고정 액션 바 (6 위젯 통일). 컨트롤 phase(실행
            전) 에서만 노출: 실행 중 timeline / 완료 done 화면에서는 숨김. */}
        {!deskRunning && (!showResult || forceControls) && (
          <WidgetPrimaryCta
            label={tDesk('search')}
            busyLabel={tCommon('loading')}
            busy={Boolean(submitting || pendingJobId || isWorking)}
            disabled={!canRun}
            onClick={onClickRun}
          />
        )}
      </div>

      <Modal
        open={previewOpen && showResult && job != null}
        onClose={() => setPreviewOpen(false)}
        size="full"
        title={job ? `${job.keywords.join(', ')} · ${tDesk('reportTitle')}` : ''}
        footer={
          job ? (
            <>
              <DownloadMenu
                tone="ghost"
                align="end"
                disabled={exporting}
                items={[
                  {
                    format: 'md',
                    kind: 'blob',
                    filename: `${buildFilename()}.md`,
                    build: () =>
                      new Blob([job.output ?? ''], {
                        type: 'text/markdown;charset=utf-8',
                      }),
                  },
                  {
                    format: 'docx',
                    kind: 'action',
                    onSelect: () => downloadDocx(job.output ?? ''),
                  },
                ]}
              />
              <ShareMenu
                align="end"
                disabled={!job.output}
                items={[
                  {
                    destination: 'google-docs',
                    title: buildFilename(),
                    getBlob: async () => {
                      const res = await fetch('/api/desk/export', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          markdown: job.output ?? '',
                          filename: buildFilename(),
                          title: job.keywords?.length
                            ? `데스크 리서치 — ${job.keywords.join(', ')}`
                            : '데스크 리서치',
                        }),
                      });
                      return {
                        blob: await res.blob(),
                        mimeType:
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      };
                    },
                  },
                ]}
              />
            </>
          ) : null
        }
      >
        {job && <DeskResultView job={job} tDesk={tDesk} />}
      </Modal>

      {/* 통일 "전체 보기" — 상단 "이전 산출물" 드롭다운(최근 20개 persist
          job, 리크루팅 응답 fullview 의 폼 선택 Select 와 동일 패턴) + 아래
          선택 job 리포트. 카드 본문은 세션 스코프 latestJob 만 보여주므로
          옛 완료 job 은 여기서 접근한다. 공유 모달 slot 으로 portal 되며
          chrome(title/subtitle/닫기×)은 WidgetFullviewPanel 이 소유. */}
      {renderInSlot(
        <WidgetFullviewPanel
          title="데스크 리서치 — 전체 보기"
          subtitle={
            fullviewJob
              ? `${fullviewJob.keywords.join(', ')} · ${tDesk('reportTitle')}`
              : '완료된 리포트를 풀스크린으로 봅니다'
          }
          onClose={closeFullview}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3">
              {jobs.length > 0 ? (
                <Select
                  size="sm"
                  fullWidth={false}
                  aria-label="이전 산출물 선택"
                  className="min-w-[280px]"
                  value={fullviewJob?.id ?? ''}
                  onChange={(e) => setSelectedJobId(e.target.value || null)}
                  options={jobs.map((j) => ({
                    value: j.id,
                    label: deskJobSelectorLabel(j),
                  }))}
                />
              ) : (
                <span className="text-sm text-mute-soft">이전 산출물 없음</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {fullviewJob && fullviewJob.status === 'done' && fullviewJob.output ? (
                <div className="px-6 py-6">
                  <DeskResultView job={fullviewJob} tDesk={tDesk} />
                </div>
              ) : fullviewJob ? (
                <div className="flex h-full items-center justify-center p-10">
                  <EmptyState
                    tone="subtle"
                    title="이 산출물은 완료되지 않았습니다"
                    description="위 드롭다운에서 완료된 다른 산출물을 선택해 주세요."
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-10">
                  <EmptyState
                    tone="subtle"
                    title="아직 완료된 리포트가 없습니다"
                    description="검색을 실행하면 결과 리포트를 여기서 풀스크린으로 볼 수 있어요."
                  />
                </div>
              )}
            </div>
          </div>
        </WidgetFullviewPanel>,
      )}
    </>
  );
}

// StatePill 은 widget-shell 측에서 그림 — body 안에서는 제거 (헤더 stripped).
