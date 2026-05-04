'use client';

import { useState, useRef, useEffect } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  FEATURES,
  FEATURE_GROUPS,
  type FeatureKey,
  type FeatureGroupKey,
} from '@/lib/features';
import { useInterviewJob } from './interview-job-provider';
import { useTranscriptJobs } from './transcript-job-provider';
import { useWorkspace } from './workspace-provider';
import { useGenerationJobs } from './generation-job-provider';
import { SEND_TO_MAP } from '@/lib/workspace';
import { SidebarAccount } from './sidebar-account';

type SidebarProject = { id: string; name: string };

type Props = {
  projects: SidebarProject[];
  email: string | null;
  credits: number | null;
  isAuthed: boolean;
};

const COLLAPSE_STORAGE_KEY = 'sidebar:collapsed-groups:v1';

const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f] as const));

export function Sidebar({ projects, email, credits, isAuthed }: Props) {
  const pathname = usePathname();
  const t = useTranslations('Sidebar');
  const tProjects = useTranslations('Projects');
  const tBrand = useTranslations('Brand');
  const tGroups = useTranslations('SidebarGroups');

  const interviewJob = useInterviewJob();
  const transcriptJobs = useTranscriptJobs();
  const generationJobs = useGenerationJobs();
  // A feature is "busy" if its dedicated job provider says so OR a
  // one-shot generation is running in the GenerationJobProvider.
  // The sidebar reads this on every render so the indicator follows
  // the user across navigation.
  function isBusy(key: FeatureKey): boolean {
    if (key === 'interviews') return interviewJob.isWorking;
    if (key === 'quotes') return transcriptJobs.isWorking;
    return generationJobs.isWorking(key);
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
      if (next.has(g)) next.delete(g);
      else next.add(g);
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
            <div className="absolute left-2 right-0 top-full z-30 mt-1 max-h-[280px] overflow-y-auto border border-line bg-paper py-1 [border-radius:4px]">
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
                  {g.features.map((key) => {
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
                          {busy && (
                            <span
                              title={t('working')}
                              className="flex shrink-0 items-center gap-1 text-[9.5px] uppercase tracking-[0.18em] text-amore"
                            >
                              <span className="inline-block h-1.5 w-1.5 animate-pulse [border-radius:9999px] bg-amore" />
                              {t('working')}
                            </span>
                          )}
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

      <SidebarAccount email={email} credits={credits} isAuthed={isAuthed} />
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
