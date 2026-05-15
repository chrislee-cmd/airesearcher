'use client';

import { useState, useRef, useEffect } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  FEATURES,
  FEATURE_GROUPS,
  PREVIEW_FEATURES,
  type FeatureKey,
  type FeatureGroupKey,
} from '@/lib/features';
import { useInterviewJob } from './interview-job-provider';
import { useTranscriptJobs } from './transcript-job-provider';
import { useDeskJobs } from './desk-job-provider';
import { useWorkspace } from './workspace-provider';
import { useGenerationJobs } from './generation-job-provider';
import { SEND_TO_MAP } from '@/lib/workspace';
import { SidebarAccount } from './sidebar-account';
import { track } from './mixpanel-provider';

type SidebarProject = { id: string; name: string };

type Props = {
  projects: SidebarProject[];
  email: string | null;
  credits: number | null;
  isAuthed: boolean;
  // Preview features (recruiting / transcripts script-gen / survey /
  // analyzer) are dev-in-progress and stay hidden from regular users.
  // Flipped on for super-admin orgs (organizations.is_unlimited).
  showPreviewFeatures?: boolean;
  // Hardcoded-email super-admin gate. Drives the cross-provider API
  // usage menu entry; nothing else.
  isSuperAdmin?: boolean;
};

const COLLAPSE_STORAGE_KEY = 'sidebar:collapsed-groups:v1';

type ProgressPhase =
  | 'expanding'
  | 'crawling'
  | 'summarizing'
  | 'uploading'
  | 'submitting'
  | 'transcribing'
  | 'converting'
  | 'extracting'
  | 'analyzing'
  | 'synthesizing'
  | 'normalizing'
  | 'generating';

// Stage weighting for multi-phase jobs. The numeric percent shown next
// to the spinner is `base + stageProgress * width` for the current
// phase, so every transition between phases visibly bumps the bar
// forward and the user never sees 100% before the job actually
// finishes (last phase is capped well below 100 — `done` flips the
// indicator to the green "작업완료" badge instead).
const DESK_STAGE = {
  expanding: { base: 0, width: 25 },
  crawling: { base: 25, width: 41 }, // 25 → 66
  summarizing: { base: 66, width: 29 }, // 66 → 95
} as const;
const INTERVIEW_STAGE = {
  converting: { base: 0, width: 15 },
  extracting: { base: 15, width: 15 }, // 15 → 30
  analyzing: { base: 30, width: 25 }, // 30 → 55
  summarizing: { base: 55, width: 20 }, // 55 → 75
  synthesizing: { base: 75, width: 20 }, // 75 → 95
} as const;

const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f] as const));

export function Sidebar({
  projects,
  email,
  credits,
  isAuthed,
  showPreviewFeatures = false,
  isSuperAdmin = false,
}: Props) {
  const pathname = usePathname();
  const t = useTranslations('Sidebar');
  const tProjects = useTranslations('Projects');
  const tBrand = useTranslations('Brand');
  const tGroups = useTranslations('SidebarGroups');

  const interviewJob = useInterviewJob();
  const transcriptJobs = useTranscriptJobs();
  const deskJobs = useDeskJobs();
  const generationJobs = useGenerationJobs();
  const tProg = useTranslations('Sidebar.progress');
  // A feature is "busy" if its dedicated job provider says so OR a
  // one-shot generation is running in the GenerationJobProvider.
  // The sidebar reads this on every render so the indicator follows
  // the user across navigation.
  function isBusy(key: FeatureKey): boolean {
    if (key === 'interviews') return interviewJob.isWorking;
    if (key === 'quotes') return transcriptJobs.isWorking;
    if (key === 'desk') return deskJobs.isWorking;
    return generationJobs.isWorking(key);
  }

  // Numeric percent or phase label to render next to the spinner.
  // Multi-phase jobs use stage weighting so transitions bump the bar
  // forward instead of resetting; %s are capped at 99 so 100 is
  // reserved for the actual `done` transition.
  function getProgressDetail(
    key: FeatureKey,
  ): { percent?: number; phase?: ProgressPhase } | null {
    if (key === 'desk') {
      const job = deskJobs.latestJob;
      if (!job) return null;
      const p = job.progress;
      if (p.phase === 'expanding') {
        return { percent: DESK_STAGE.expanding.base, phase: 'expanding' };
      }
      if (p.phase === 'crawling') {
        const s = DESK_STAGE.crawling;
        let frac = 0;
        if (typeof p.crawl_total === 'number' && p.crawl_total > 0) {
          frac = Math.min(1, (p.crawl_done ?? 0) / p.crawl_total);
        }
        return {
          percent: Math.min(99, Math.round(s.base + frac * s.width)),
          phase: 'crawling',
        };
      }
      if (p.phase === 'summarizing') {
        return { percent: DESK_STAGE.summarizing.base, phase: 'summarizing' };
      }
      // queued — job exists but no phase yet
      return { percent: 0 };
    }
    if (key === 'interviews') {
      // Order matters — later stages override earlier flags so a job
      // mid-synthesis still reads as 75%+, not 0%.
      if (interviewJob.verticallySynthesizing) {
        return {
          percent: INTERVIEW_STAGE.synthesizing.base,
          phase: 'synthesizing',
        };
      }
      if (interviewJob.summarizing) {
        return {
          percent: INTERVIEW_STAGE.summarizing.base,
          phase: 'summarizing',
        };
      }
      if (interviewJob.analyzing) {
        return {
          percent: INTERVIEW_STAGE.analyzing.base,
          phase: 'analyzing',
        };
      }
      const items = interviewJob.items;
      const extractedDone = items.filter(
        (i) => i.extractStatus === 'done',
      ).length;
      const extractingNow = items.some(
        (i) => i.extractStatus === 'extracting',
      );
      if (extractingNow) {
        const s = INTERVIEW_STAGE.extracting;
        const frac = items.length > 0 ? extractedDone / items.length : 0;
        return {
          percent: Math.min(99, Math.round(s.base + frac * s.width)),
          phase: 'extracting',
        };
      }
      if (interviewJob.convertingAll) {
        const s = INTERVIEW_STAGE.converting;
        const total = interviewJob.queuedCount + interviewJob.doneCount;
        const frac = total > 0 ? interviewJob.doneCount / total : 0;
        return {
          percent: Math.min(99, Math.round(s.base + frac * s.width)),
          phase: 'converting',
        };
      }
      return null;
    }
    if (key === 'quotes') {
      const uploads = Object.values(transcriptJobs.localUploads);
      if (uploads.length > 0) {
        const avg = Math.round(
          uploads.reduce((a, b) => a + b, 0) / uploads.length,
        );
        return { percent: Math.min(99, avg), phase: 'uploading' };
      }
      const active = transcriptJobs.jobs.find(
        (j) =>
          j.status === 'queued' ||
          j.status === 'submitting' ||
          j.status === 'transcribing',
      );
      if (!active) return null;
      if (active.status === 'transcribing') return { phase: 'transcribing' };
      return { phase: 'submitting' };
    }
    // GenerationJobProvider-backed features: read percent/phase that
    // the feature's own component publishes via `setProgress` (e.g.
    // reports). Features that never call setProgress fall through to
    // the plain spinner.
    const gen = generationJobs.get(key);
    if (gen.status === 'running') {
      const { percent, phase } = gen.progress;
      if (typeof percent === 'number' || phase) {
        return { percent, phase: phase as ProgressPhase | undefined };
      }
    }
    return null;
  }

  // Per-feature busy → idle transitions raise a green "작업완료" badge.
  // It persists until the user either visits the feature page or
  // refreshes — page refresh wipes this in-memory state, navigation
  // clears it via the pathname effect below.
  const prevBusyRef = useRef<Map<FeatureKey, boolean>>(new Map());
  const [doneFlags, setDoneFlags] = useState<Set<FeatureKey>>(new Set());
  useEffect(() => {
    const transitioned: FeatureKey[] = [];
    for (const f of FEATURES) {
      const cur = isBusy(f.key);
      const prev = prevBusyRef.current.get(f.key) ?? false;
      if (prev && !cur) transitioned.push(f.key);
      prevBusyRef.current.set(f.key, cur);
    }
    if (transitioned.length === 0) return;
    setDoneFlags((prev) => {
      const next = new Set(prev);
      for (const k of transitioned) next.add(k);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    interviewJob.isWorking,
    transcriptJobs.isWorking,
    deskJobs.isWorking,
    generationJobs,
  ]);
  // Clear the flag once the user actually visits the feature.
  useEffect(() => {
    const matched = FEATURES.find((f) => f.href === pathname);
    if (!matched) return;
    setDoneFlags((prev) => {
      if (!prev.has(matched.key)) return prev;
      const next = new Set(prev);
      next.delete(matched.key);
      return next;
    });
  }, [pathname]);
  function isRecentlyDone(key: FeatureKey): boolean {
    return doneFlags.has(key);
  }

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const workspace = useWorkspace();
  const router = useRouter();
  const [dragOverFeature, setDragOverFeature] = useState<FeatureKey | null>(null);
  const dragging = workspace.dragging;
  const compatibleTargets = dragging
    ? new Set(SEND_TO_MAP[dragging.sourceFeature] ?? [])
    : null;

  // Persist which groups are collapsed across reloads. Default = all open.
  // Group containing the current page auto-opens regardless of saved state
  // so deep links never land you on a hidden item.
  const [collapsed, setCollapsed] = useState<Set<FeatureGroupKey>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setCollapsed(new Set(arr as FeatureGroupKey[]));
      }
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        JSON.stringify(Array.from(collapsed)),
      );
    } catch {}
  }, [collapsed, hydrated]);

  // Auto-open the group whose feature matches current path — but only
  // when the path actually changes. After that, user toggle wins so
  // closing a section while on a page inside it stays closed.
  const activeGroup = FEATURE_GROUPS.find((g) =>
    g.features.some((k) => {
      const f = FEATURE_BY_KEY.get(k);
      return f && pathname === f.href;
    }),
  )?.key;
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsed((prev) => {
      if (!prev.has(activeGroup)) return prev;
      const next = new Set(prev);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const projectsActive =
    pathname === '/projects' || pathname.startsWith('/projects/');

  function toggleGroup(g: FeatureGroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const wasCollapsed = next.has(g);
      if (wasCollapsed) next.delete(g);
      else next.add(g);
      track('sidebar_group_toggle_click', {
        group: g,
        next_state: wasCollapsed ? 'open' : 'collapsed',
      });
      return next;
    });
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[224px] shrink-0 flex-col border-r border-line bg-paper md:flex">
      <div className="px-7 pb-6 pt-7">
        <Link
          href="/dashboard"
          className="block transition-opacity duration-[120ms] hover:opacity-80"
        >
          <div className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {tBrand('name')}
          </div>
          <div className="mt-1 h-px w-6 bg-amore" />
        </Link>
      </div>

      {/* Projects entry */}
      <div className="px-3 pb-2">
        <div
          ref={dropdownRef}
          className="relative flex items-stretch border-l-2 border-transparent"
          style={projectsActive ? { borderColor: 'var(--color-amore)' } : undefined}
        >
          <Link
            href="/projects"
            prefetch
            onClick={() => track('sidebar_projects_click')}
            className={`flex-1 px-4 py-2 text-[12.5px] transition-colors duration-[120ms] ${
              projectsActive
                ? 'font-semibold text-ink-2'
                : 'text-mute hover:text-ink-2'
            }`}
          >
            {t('viewProjects')}
          </Link>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-label={tProjects('navigate')}
            aria-expanded={dropdownOpen}
            className={`flex w-9 items-center justify-center text-mute-soft transition-colors duration-[120ms] hover:text-ink-2 ${
              dropdownOpen ? 'text-ink-2' : ''
            }`}
          >
            <Chevron open={dropdownOpen} />
          </button>

          {dropdownOpen && (
            <div className="absolute left-2 right-0 top-full z-30 mt-1 max-h-[280px] overflow-y-auto border border-line bg-paper py-1 [border-radius:14px]">
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-[11.5px] text-mute-soft">
                  {tProjects('noProjects')}
                </div>
              ) : (
                projects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    onClick={() => setDropdownOpen(false)}
                    className="block truncate px-3 py-1.5 text-[12px] text-mute transition-colors duration-[120ms] hover:bg-paper-soft hover:text-ink-2"
                  >
                    {p.name}
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {FEATURE_GROUPS.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <section key={g.key} className="mt-3 first:mt-2">
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between gap-2 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
              >
                <span>{tGroups(g.key)}</span>
                <Chevron open={!isCollapsed} small />
              </button>
              {!isCollapsed && (
                <ul className="mt-0.5">
                  {g.features
                    .filter(
                      (key) =>
                        showPreviewFeatures || !PREVIEW_FEATURES.has(key),
                    )
                    .map((key) => {
                    const f = FEATURE_BY_KEY.get(key);
                    if (!f) return null;
                    const active = pathname === f.href;
                    const busy = isBusy(f.key);
                    const isDragOver = dragOverFeature === f.key;
                    const isCompatible =
                      compatibleTargets?.has(f.key) ?? false;
                    const isDimmed =
                      !!dragging &&
                      !isCompatible &&
                      f.key !== dragging.sourceFeature;
                    return (
                      <li key={f.key}>
                        <Link
                          href={f.href}
                          prefetch
                          onClick={() =>
                            track(`sidebar_nav_${f.key}_click`, {
                              target: f.key,
                              group: g.key,
                            })
                          }
                          onDragOver={(e) => {
                            if (!dragging) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                            if (dragOverFeature !== f.key)
                              setDragOverFeature(f.key);
                          }}
                          onDragLeave={() => {
                            if (dragOverFeature === f.key)
                              setDragOverFeature(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverFeature(null);
                            const manyRaw = e.dataTransfer.getData(
                              'application/x-workspace-artifacts',
                            );
                            if (manyRaw) {
                              try {
                                const ids = JSON.parse(manyRaw) as string[];
                                const path = workspace.sendMany(ids, f.key);
                                workspace.setDragging(null);
                                if (path) router.push(path);
                                return;
                              } catch {}
                            }
                            const id = e.dataTransfer.getData(
                              'application/x-workspace-artifact',
                            );
                            if (!id) return;
                            const path = workspace.sendTo(id, f.key);
                            workspace.setDragging(null);
                            if (path) router.push(path);
                          }}
                          className={`flex items-center justify-between gap-2 px-4 py-1.5 text-[12.5px] transition-colors duration-[120ms] border-l-2 ${
                            active
                              ? 'border-amore text-ink-2 font-semibold'
                              : isDragOver
                              ? 'border-amore bg-paper-soft text-ink-2'
                              : isCompatible
                              ? 'border-amore text-ink-2'
                              : isDimmed
                              ? 'border-transparent text-mute-soft'
                              : 'border-transparent text-mute hover:text-ink-2'
                          }`}
                        >
                          <span className="truncate">{t(f.key)}</span>
                          {busy ? (() => {
                            const detail = getProgressDetail(f.key);
                            const text =
                              detail?.percent != null
                                ? `${detail.percent}%`
                                : detail?.phase
                                ? tProg(detail.phase)
                                : t('working');
                            return (
                              <span
                                title={t('working')}
                                className="flex shrink-0 items-center gap-1 text-[9.5px] uppercase tracking-[0.18em] text-amore"
                              >
                                <Spinner />
                                {text}
                              </span>
                            );
                          })() : isRecentlyDone(f.key) ? (
                            <span
                              className="flex shrink-0 items-center gap-1 text-[9.5px] uppercase tracking-[0.18em]"
                              style={{ color: 'var(--color-success, #16a34a)' }}
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 [border-radius:9999px]"
                                style={{ background: 'var(--color-success, #16a34a)' }}
                              />
                              {t('done')}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </nav>

      <SidebarAccount
        email={email}
        credits={credits}
        isAuthed={isAuthed}
        isSuperAdmin={isSuperAdmin}
      />
    </aside>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  const size = small ? 8 : 10;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform .12s ease',
      }}
      aria-hidden
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  // 9px circular ring with a 3/4 arc that rotates — reads as "infinite
  // loading" without the heavier visual weight of a full spinner.
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
