'use client';

import { useState, type KeyboardEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { track as trackEvent } from '@/lib/analytics/events';
import { CreateProjectModal } from './create-project-modal';
import { CrossProjectPicker } from './cross-project-picker';
import { UploadModal } from './upload-modal';

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
  // Selected project ids to search across (사용자 결정 2026-07-03: the entry
  // now opens a picker first, so this always carries ≥ 1 id).
  onOpenCrossSearch: (projectIds: string[]) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const locale = useLocale();
  const { projects, isLoading, create } = useInterviewV2Projects();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const handleCreate = async (name: string, description?: string) => {
    const project = await create(name, description);
    if (project) {
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_create',
      });
      setCreateOpen(false);
      onOpenProject(project.id);
      return project.id;
    }
    return null;
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-6">
      {/* Top actions — 📤 업로드 (프로젝트 설정 gate 뒤 저장) + 🌐 전체 검색.
          업로드는 여기서 프로젝트 미선택 상태로 열려 Step 2(프로젝트 설정)를
          강제하고, 완료 시 해당 프로젝트 상세로 이동해 새 파일을 바로 노출. */}
      <div className="mb-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setUploadOpen(true)}
          leftIcon={<span aria-hidden>📤</span>}
        >
          {t('upload')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPickerOpen(true)}
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

      {/* Project-less upload → Step 2 forces project setup. On success jump
          into that project's detail so the freshly indexed files show up. */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(id) => {
          setUploadOpen(false);
          onOpenProject(id);
        }}
      />

      {/* Mount only while open so the selection resets on every reopen. */}
      {pickerOpen && (
        <CrossProjectPicker
          open
          onClose={() => setPickerOpen(false)}
          onConfirm={onOpenCrossSearch}
        />
      )}
    </div>
  );
}
