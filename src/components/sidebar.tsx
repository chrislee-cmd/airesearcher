'use client';

import { useState, useRef, useEffect } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { FEATURES, type FeatureKey } from '@/lib/features';
import { useInterviewJob } from './interview-job-provider';
import { useTranscriptJobs } from './transcript-job-provider';

type SidebarProject = { id: string; name: string };

export function Sidebar({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname();
  const t = useTranslations('Sidebar');
  const tProjects = useTranslations('Projects');
  const tBrand = useTranslations('Brand');

  const interviewJob = useInterviewJob();
  const transcriptJobs = useTranscriptJobs();
  // Per-feature in-flight state. Keyed by FeatureKey so future features
  // can light up without further sidebar plumbing — they just register
  // their own "working" flag here.
  const featureBusy: Partial<Record<FeatureKey, boolean>> = {
    interviews: interviewJob.isWorking,
    quotes: transcriptJobs.isWorking,
  };

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

      {/* Projects entry — link + chevron dropdown */}
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

      <nav className="flex-1 px-3 pb-7">
        <ul>
          {FEATURES.map((f) => {
            const active = pathname === f.href;
            const busy = !!featureBusy[f.key];
            return (
              <li key={f.key}>
                <Link
                  href={f.href}
                  className={`flex items-center justify-between gap-2 px-4 py-2 text-[12.5px] transition-colors duration-[120ms] border-l-2 ${
                    active
                      ? 'border-amore text-ink-2 font-semibold'
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
      </nav>

      <div className="border-t border-line-soft px-7 py-5">
        <div className="flex flex-col gap-2 text-[11px] text-mute-soft">
          <Link
            href="/members"
            className={`transition-colors duration-[120ms] hover:text-ink-2 ${
              pathname === '/members' ? 'text-ink-2' : ''
            }`}
          >
            {t('members')}
          </Link>
          <Link
            href="/settings"
            className={`transition-colors duration-[120ms] hover:text-ink-2 ${
              pathname === '/settings' ? 'text-ink-2' : ''
            }`}
          >
            {t('settings')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform .12s ease',
      }}
      aria-hidden
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
