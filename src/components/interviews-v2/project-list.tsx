'use client';

import { useState, type KeyboardEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateProjectModal } from './create-project-modal';

// Interview V2 — project grid (default fullview). Each card opens the
// detail view; the trailing "+ 새 프로젝트" tile opens the create modal and,
// on success, jumps straight into the new project's detail view.
//
// Cards are clickable div[role=button] rather than native <button>: the
// design-system lint forbids native <button> outside src/components/ui, and
// the Button primitive's capsule chrome doesn't fit a content card.

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const min = Math.round(diff / 60_000);
  if (min < 1) return rtf.format(0, 'minute');
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, 'hour');
  const day = Math.round(hr / 24);
  if (day < 7) return rtf.format(-day, 'day');
  const wk = Math.round(day / 7);
  if (wk < 5) return rtf.format(-wk, 'week');
  const mo = Math.round(day / 30);
  if (mo < 12) return rtf.format(-mo, 'month');
  return rtf.format(-Math.round(day / 365), 'year');
}

function onEnterOrSpace(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

const CARD =
  'flex cursor-pointer flex-col items-start justify-between gap-4 rounded-sm border border-line bg-paper p-5 text-left transition-colors hover:border-ink focus-visible:outline-none focus-visible:border-amore';

export function ProjectList({
  onOpenProject,
  onOpenCrossSearch,
}: {
  onOpenProject: (id: string) => void;
  onOpenCrossSearch: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const locale = useLocale();
  const { projects, isLoading, create } = useInterviewV2Projects();
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreate = async (name: string, description?: string) => {
    const project = await create(name, description);
    if (project) {
      setCreateOpen(false);
      onOpenProject(project.id);
      return project.id;
    }
    return null;
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-6">
      {/* Cross-project search entry — opens the search chat with no project
          context (project_id: null → every project scanned). */}
      <div className="mb-4 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenCrossSearch}
          leftIcon={<span aria-hidden>🌐</span>}
        >
          {t('crossSearch')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[132px] rounded-sm" />
            <Skeleton className="h-[132px] rounded-sm" />
            <Skeleton className="h-[132px] rounded-sm" />
          </>
        ) : (
          <>
            {projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                className={CARD}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={onEnterOrSpace(() => onOpenProject(p.id))}
              >
                <div className="min-w-0 w-full">
                  <div className="truncate text-lg font-semibold text-ink-2">
                    {p.name}
                  </div>
                  {p.description && (
                    <div className="mt-1 line-clamp-2 text-sm text-mute-soft">
                      {p.description}
                    </div>
                  )}
                </div>
                <div className="text-xs text-mute-soft tabular-nums">
                  {t('updatedAt', {
                    time: relativeTime(p.updated_at, locale),
                  })}
                </div>
              </div>
            ))}

            <div
              role="button"
              tabIndex={0}
              className={`${CARD} min-h-[132px] items-center justify-center border-dashed text-mute hover:text-ink`}
              onClick={() => setCreateOpen(true)}
              onKeyDown={onEnterOrSpace(() => setCreateOpen(true))}
            >
              <span className="text-lg font-semibold">+ {t('newProject')}</span>
            </div>
          </>
        )}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
