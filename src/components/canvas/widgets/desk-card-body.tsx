'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
import { DeskReportView } from '@/components/canvas/widgets/desk-result/desk-report-view';
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
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { ChipInput } from '@/components/ui/chip-input';
import { DateRangePopover } from '@/components/ui/date-range-popover';
import { SelectMenu } from '@/components/ui/select-menu';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import { Field } from '@/components/canvas/shell/field';
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
  DESK_SOURCES,
  DESK_SOURCE_REGISTRY,
  KR_ONLY_GROUPS,
  UI_CATEGORY_ORDER,
  UI_CATEGORY_META,
  type DeskRegion,
  type DeskSourceId,
  type UICategory,
} from '@/lib/desk-sources';

type RangePreset = 'all' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
const RANGE_PRESETS: { id: RangePreset; days: number | null }[] = [
  { id: 'all', days: null },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'quarter', days: 90 },
  { id: 'year', days: 365 },
  { id: 'custom', days: null },
];

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n\t、·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// region 이 결정하는 "노출 가능 소스" 집합. KR-only 그룹 (네이버/카카오/DART/
// 국내학술/한국은행/KOSIS) 은 selected regions 에 KR 이 포함될 때만 포함 — 그 외
// region 만 선택하면 결과가 거의 없어 API quota 낭비 (결정 3: 국내 소스 group 은
// 비-KR 지역에서 아예 숨김). region 변경 시 이 집합이 새 기본 선택이 되고, 그
// 위에서 사용자가 카테고리 피커로 개별 소스를 토글해 좁힐 수 있다.
function sourcesForRegions(regions: Set<DeskRegion>): Set<DeskSourceId> {
  const includeKrOnly = regions.has('KR');
  const out = new Set<DeskSourceId>();
  for (const s of DESK_SOURCES) {
    if (!includeKrOnly && KR_ONLY_GROUPS.includes(s.group)) continue;
    out.add(s.id);
  }
  return out;
}

// ─── SourceGridPicker — 5-카테고리 all-or-nothing grid popover ──────────────
// 옛 SourceCategoryPicker (카테고리별 collapsible + 개별 소스 checkbox) 를 완전
// 폐기·대체. "수집 소스" trigger 버튼을 누르면 portal popover 안에 5 카테고리
// 카드가 2열 grid 로 뜬다. 카드 클릭 = 그 카테고리를 통째로 토글 — 하위 소스
// 개별 체크는 없다 (all-or-nothing). 선택 시각 = amore 유색 배경 + border-amore
// + ✓ (사용자 결정 4). region 이 그 카테고리의 소스를 전부 가리면(비-KR 지역의
// 국내 전용 카테고리 등) 카드는 disabled. widget-shell 의 overflow:hidden 안이라
// SelectMenu 와 동일하게 portal + position:fixed 로 잘림을 피한다.
//
// env 없는 소스: API 키는 전부 서버 전용(env.ts server 스키마)이라 client 는
// 실제 set 여부를 알 수 없다 (옛 PR #732 주석과 동일 사실). 따라서 카드/카테고리
// 를 임의로 disable 하지 않고 — 서버가 미설정 소스를 이미 graceful-drop
// (sourceMissingKey, /api/desk) — 어떤 키가 필요한지 카드 tooltip 으로만 안내
// 한다 (spec 결정 E: 카테고리 활성 유지 + env-disabled 소스는 서버단 자동 skip).

function SourceGridPicker({
  order,
  selected,
  onToggle,
  enabledFor,
  disabled,
  categoryLabel,
  categoryIcon,
  categoryHint,
  placeholder,
}: {
  order: UICategory[];
  selected: Set<UICategory>;
  onToggle: (c: UICategory) => void;
  enabledFor: (c: UICategory) => boolean;
  disabled?: boolean;
  categoryLabel: (c: UICategory) => string;
  categoryIcon: (c: UICategory) => string;
  categoryHint: (c: UICategory) => string | undefined;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const update = () => setRect(wrapRef.current!.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function esc(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', esc as EventListener);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', esc as EventListener);
    };
  }, [open]);

  // trigger 요약 — 선택된(그리고 region 가시) 카테고리를 아이콘+라벨로 나열.
  const chosen = order.filter((c) => selected.has(c) && enabledFor(c));
  const summary =
    chosen.length === 0
      ? placeholder
      : chosen.map((c) => `${categoryIcon(c)} ${categoryLabel(c)}`).join(' · ');

  return (
    <div ref={wrapRef} className="relative">
      {/* eslint-disable-next-line react/forbid-elements -- popover trigger:
          summary chip + chevron form-control shape outside Button primitive
          variants (mirrors the ui SelectMenu primitive trigger). */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-8 w-full items-center justify-between gap-2 rounded-xs border border-line bg-paper px-2 py-1 text-md text-ink hover:border-ink focus-visible:border-amore disabled:opacity-50"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="truncate text-left">{summary}</span>
        <span aria-hidden className="text-mute-soft">▾</span>
      </button>
      {open && rect && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            className="fixed z-overlay rounded-xs border-[2px] border-ink bg-paper shadow-[3px_3px_0_var(--canvas-card-border)]"
            style={{
              left: rect.left,
              top: rect.bottom + 4,
              minWidth: Math.max(rect.width, 320),
            }}
          >
            <div className="grid grid-cols-2 gap-2 p-3">
              {order.map((c) => {
                const isSelected = selected.has(c);
                const cardEnabled = enabledFor(c);
                const hint = categoryHint(c);
                return (
                  /* eslint-disable-next-line react/forbid-elements -- category
                     card: custom flex-col toggle surface (icon + label + ✓),
                     not expressible as a Button primitive variant. */
                  <button
                    key={c}
                    type="button"
                    disabled={!cardEnabled}
                    title={hint}
                    aria-pressed={isSelected}
                    onClick={() => onToggle(c)}
                    className={
                      'relative flex flex-col items-center gap-2 rounded-sm border-[2px] p-4 text-center transition-colors ' +
                      (!cardEnabled
                        ? 'cursor-not-allowed border-line-soft bg-paper opacity-40'
                        : isSelected
                          ? 'border-amore bg-amore-bg'
                          : 'border-line-soft bg-paper hover:bg-paper-soft')
                    }
                  >
                    {isSelected && cardEnabled && (
                      <span aria-hidden className="absolute right-2 top-2 text-amore">
                        ✓
                      </span>
                    )}
                    <span aria-hidden className="text-3xl leading-none">
                      {categoryIcon(c)}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {categoryLabel(c)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}


export function DeskCardBody() {
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const tWidgets = useTranslations('Widgets');
  const tProcess = useTranslations('Process');
  const locale = useLocale();
  const requireAuth = useRequireAuth();
  const { latestJob, isWorking, cancelJob } = useDeskJobs();
  const { notify: notifyDeduction } = useCreditDeduction();

  // ─── inputs ──────────────────────────────────────────────────────────────
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
  // 5 카테고리 all-or-nothing 선택 (하위 개별 소스 체크 폐기 — supersede
  // PR #732). 기본 = 5 카테고리 전체 선택 — KR 기본 지역에서 모든 소스가
  // 켜지던 옛 동작과 동일 범위.
  const [selectedCategories, setSelectedCategories] = useState<Set<UICategory>>(
    () => new Set(UI_CATEGORY_ORDER),
  );

  // 카테고리 통째 토글 — 카드 클릭 시 그 카테고리의 모든 소스를 켜고/끈다.
  function toggleCategory(c: UICategory) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  // region 이 노출을 허용하는 소스 집합 (KR-only 소스는 비-KR 지역에서 제외).
  const regionVisible = useMemo(() => sourcesForRegions(regions), [regions]);

  // 카테고리 → region 가시 소스만 남긴 매핑. env-missing 소스는 서버가
  // graceful-drop 하므로 client 에선 거르지 않는다 (SourceGridPicker 주석 참고).
  const visibleSourceIdsFor = useMemo(() => {
    const map = new Map<UICategory, DeskSourceId[]>();
    for (const c of UI_CATEGORY_ORDER) {
      map.set(
        c,
        UI_CATEGORY_META[c].sourceIds.filter((id) => regionVisible.has(id)),
      );
    }
    return map;
  }, [regionVisible]);

  // 카드 활성 여부 — region 이 그 카테고리의 소스를 전부 가리면 비활성.
  const categoryEnabled = (c: UICategory) =>
    (visibleSourceIdsFor.get(c)?.length ?? 0) > 0;

  // 카테고리 안 소스가 요구하는 env 키 모음 — 카드 tooltip 안내. 키는 서버
  // 전용이라 client 는 set 여부를 모른다 → 자동 disable 안 하고 안내만.
  const categoryHint = (c: UICategory): string | undefined => {
    const keys = new Set<string>();
    for (const id of UI_CATEGORY_META[c].sourceIds) {
      for (const k of DESK_SOURCE_REGISTRY[id].envKeys ?? []) keys.add(k);
    }
    return keys.size
      ? `${tDesk('sourceEnvHint')}: ${Array.from(keys).join(' / ')}`
      : undefined;
  };

  // 선택된(그리고 region 가시) 카테고리 → 실제 API 로 보낼 source id 목록.
  // 카테고리는 소스를 정확히 1번씩 분할하므로 dedup 불필요.
  const selectedSourceIds = useMemo(() => {
    const out: DeskSourceId[] = [];
    for (const c of UI_CATEGORY_ORDER) {
      if (!selectedCategories.has(c)) continue;
      out.push(...(visibleSourceIdsFor.get(c) ?? []));
    }
    return out;
  }, [selectedCategories, visibleSourceIdsFor]);

  // region 갱신은 SelectMenu onChange 콜백에서 직접 처리 (다중 선택 + 최소
  // 1개 보장 inline). 소스 선택은 위 selectedCategories 기반.

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
          sources: selectedSourceIds,
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
  const canRun =
    !submitting &&
    !pendingJobId &&
    !isWorking &&
    hasKeywords &&
    selectedSourceIds.length > 0;
  // ── Input-time scope estimate (spec-down §F) ──────────────────────────────
  // Rough "약 N회 검색" so the user can shrink scope before a heavy run that
  // would only yield a raw-data dump. A single keyword expands to +4 similar
  // server-side, so treat 1 keyword as 5. The product (kw × sources × regions)
  // is an upper bound — region-only-aware sources don't truly multiply by
  // regions — but it tracks the crawl cap math closely enough for guidance.
  const kwCountForEstimate = keywords.length + (keywordDraft.trim() ? 1 : 0);
  const effectiveKwForEstimate = kwCountForEstimate <= 1 ? 5 : kwCountForEstimate;
  const estimatedSearches = hasKeywords
    ? effectiveKwForEstimate *
      Math.max(selectedSourceIds.length, 1) *
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
  const controlsForm = (
    <div className="space-y-4">
      {/* 주제 · 키워드 (핵심 입력) */}
      <Field label={tDesk('boardTopicLabel')}>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
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

      {/* 세부 옵션 — 지역 / 기간 / 분석 방향성 */}
      <Field label={tDesk('boardOptionsLabel')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          />

          <Input
            size="sm"
            fullWidth
            value={analysisDirection}
            onChange={(e) => setAnalysisDirection(e.target.value)}
            placeholder="예: 시장 성장률 + 주요 플레이어 위주"
          />
        </div>
      </Field>

      {/* 수집 소스 — 5 카테고리 all-or-nothing grid popover (supersede PR #732
          collapsible+checkbox). 카드 선택 → 하위 소스 id 가 자동 확장돼 API 로
          전송. region 이 소스를 전부 가리는 카테고리는 카드 disabled. */}
      <Field label={tDesk('sourcesLabel')}>
        <SourceGridPicker
          order={UI_CATEGORY_ORDER}
          selected={selectedCategories}
          onToggle={toggleCategory}
          enabledFor={categoryEnabled}
          categoryLabel={(c) => tDesk(`category.${c}` as never)}
          categoryIcon={(c) => UI_CATEGORY_META[c].icon}
          categoryHint={categoryHint}
          placeholder={tDesk('sourcePickerPlaceholder')}
        />
      </Field>

      {/* Scope estimate — heavy 범위면 warning 톤 + 줄이기 유도. */}
      {hasKeywords && (
        <p
          className={`text-xs leading-[1.6] ${
            estimateHeavy ? 'text-amore' : 'text-mute-soft'
          }`}
        >
          {tDesk('estimateLabel', {
            kw: effectiveKwForEstimate,
            src: Math.max(selectedSourceIds.length, 1),
            region: Math.max(regions.size, 1),
            count: estimatedSearches,
          })}
          {' · '}
          {estimateHeavy ? tDesk('estimateHeavy') : tDesk('estimateOk')}
        </p>
      )}

      {/* 실행 CTA — 컨트롤 보드의 핵심 요소 (결정 1). 데스크는 리포트 산출
          이라 라벨은 기존 "검색" 유지 (스펙의 "매트릭스 생성" 은 형제 스펙
          템플릿 흔적 — 용어 회귀 방지). auto width + status slot = 프로빙과
          동일 pattern (primitive 통일 spec R3). status label 은 아직 없음 —
          빈 span 이 CTA 우측 정렬을 유지하고 미래 hint 확장 자리. */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-mute" />
        <ChromeButton
          variant="default"
          size="lg"
          onClick={onClickRun}
          disabled={!canRun}
        >
          {submitting || pendingJobId || isWorking
            ? tCommon('loading')
            : tDesk('search')}
        </ChromeButton>
      </div>
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
        <div
          className={
            active
              ? 'shrink-0 overflow-y-auto border-b border-line-soft px-5 py-5'
              : 'flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-5'
          }
        >
          <div className={active ? undefined : 'w-full max-w-[420px]'}>
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
          </div>
        </div>

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
        {job && <DeskReportView job={job} tDesk={tDesk} />}
      </Modal>

      {/* 통일 "전체 보기" — 가장 최근 완료 리포트를 풀스크린으로. 완료
          리포트가 없으면 안내 EmptyState. 공유 모달 slot 으로 portal 되며
          chrome(title/subtitle/닫기×)은 WidgetFullviewPanel 이 소유. */}
      {renderInSlot(
        <WidgetFullviewPanel
          title="데스크 리서치 — 전체 보기"
          subtitle={
            showResult && job
              ? `${job.keywords.join(', ')} · ${tDesk('reportTitle')}`
              : '완료된 리포트를 풀스크린으로 봅니다'
          }
          onClose={closeFullview}
        >
          {showResult && job ? (
            <div className="px-6 py-6">
              <DeskReportView job={job} tDesk={tDesk} />
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
        </WidgetFullviewPanel>,
      )}
    </>
  );
}

// StatePill 은 widget-shell 측에서 그림 — body 안에서는 제거 (헤더 stripped).
