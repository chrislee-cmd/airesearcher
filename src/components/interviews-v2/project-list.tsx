'use client';

import { useState, type KeyboardEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  useInterviewV2Projects,
  type InterviewProject,
} from '@/hooks/use-interview-v2-projects';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  DropdownMenu,
  type DropdownItem,
} from '@/components/ui/dropdown-menu';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { track as trackEvent } from '@/lib/analytics/events';
import { useToast } from '@/components/toast-provider';
import { CreateProjectModal } from './create-project-modal';
import { RenameProjectModal } from './rename-project-modal';
import { CrossProjectPicker } from './cross-project-picker';
import { UploadModal } from './upload-modal';
import { TagFilterBar } from './tag-filter-bar';

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
  'relative flex cursor-pointer flex-col items-start justify-between gap-4 rounded-sm border border-line bg-paper p-5 text-left transition-colors hover:border-ink focus-visible:outline-none focus-visible:border-amore';

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
  const {
    projects,
    tab,
    setTab,
    activeCount,
    archivedCount,
    allTags,
    isLoading,
    create,
    update,
    archive,
    unarchive,
    remove,
  } = useInterviewV2Projects();
  const { push } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // kebab 메뉴 → 이름 변경 / 삭제 대상. null = 닫힘.
  const [renameTarget, setRenameTarget] = useState<InterviewProject | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<InterviewProject | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // 선택된 필터 태그 key (lowercase) — OR 매칭. 빈 배열 = 전체.
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const toggleTagFilter = (key: string) =>
    setTagFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const tagSuggestions = allTags.map((tc) => tc.tag);

  // OR 필터: 선택 태그 중 하나라도 가진 프로젝트만. 선택 0 = 전체 노출.
  const visibleProjects =
    tagFilter.length === 0
      ? projects
      : projects.filter((p) =>
          p.tags.some((tag) => tagFilter.includes(tag.toLowerCase())),
        );

  const handleCreate = async (name: string, description?: string) => {
    const { project, error } = await create(name, description);
    if (project) {
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_create',
      });
      setCreateOpen(false);
      onOpenProject(project.id);
      return project.id;
    }
    // Surface the real reason so the failure isn't silent (the inline modal
    // text stays generic; the toast carries the raw cause).
    push(error ? `${t('createFailed')}: ${error}` : t('createFailed'), {
      tone: 'warn',
    });
    return null;
  };

  const handleArchive = async (project: InterviewProject) => {
    try {
      await archive(project.id);
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_archive',
      });
      push(t('archived'), { tone: 'info' });
    } catch {
      push(t('archiveFailed'), { tone: 'warn' });
    }
  };

  const handleUnarchive = async (project: InterviewProject) => {
    try {
      await unarchive(project.id);
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_restore',
      });
      push(t('restored'), { tone: 'info' });
    } catch {
      push(t('archiveFailed'), { tone: 'warn' });
    }
  };

  // 편집 모달 저장 — 이름·설명·태그를 한 번에. 태그 인라인 편집을 카드에서
  // 걷어낸 뒤 태그 저장의 유일한 경로다 (setTags 대신 update 로 통합 PATCH).
  const handleEditSave = async (patch: {
    name: string;
    description: string | null;
    tags: string[];
  }) => {
    if (!renameTarget) return;
    await update(renameTarget.id, patch);
    trackEvent('widget_action', {
      widget: 'interviews',
      action: 'project_rename',
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      trackEvent('widget_action', {
        widget: 'interviews',
        action: 'project_delete',
      });
      push(t('deleted'), { tone: 'info' });
      setDeleteTarget(null);
    } catch {
      push(t('deleteFailed'), { tone: 'warn' });
    } finally {
      setDeleting(false);
    }
  };

  const menuItems = (project: InterviewProject): DropdownItem[] => [
    {
      key: 'edit',
      label: t('menuEdit'),
      onSelect: () => setRenameTarget(project),
    },
    tab === 'archived'
      ? {
          key: 'restore',
          label: t('menuRestore'),
          onSelect: () => handleUnarchive(project),
        }
      : {
          key: 'archive',
          label: t('menuArchive'),
          onSelect: () => handleArchive(project),
        },
    {
      key: 'delete',
      label: <span className="text-warning">{t('menuDelete')}</span>,
      onSelect: () => setDeleteTarget(project),
    },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 py-6">
      {/* 상단 = 활성/보관 탭 toggle (왼쪽) + 업로드·전체검색 액션 (오른쪽).
          업로드는 프로젝트 미선택 상태로 열려 Step 2(프로젝트 설정)를 강제하고,
          완료 시 해당 프로젝트 상세로 이동해 새 파일을 바로 노출. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={tab === 'active' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab('active')}
          >
            {t('tabActive')} ({activeCount})
          </Button>
          <Button
            variant={tab === 'archived' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab('archived')}
          >
            {t('tabArchived')} ({archivedCount})
          </Button>
        </div>
        <div className="flex gap-2">
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
      </div>

      {/* 태그 필터 chip row — org 전체 태그(빈도순), OR 토글. 태그가 없으면 렌더 X. */}
      {!isLoading && (
        <TagFilterBar
          tags={allTags}
          selected={tagFilter}
          onToggle={toggleTagFilter}
          onClear={() => setTagFilter([])}
        />
      )}

      {!isLoading && tab === 'archived' && projects.length === 0 ? (
        <EmptyState
          tone="subtle"
          title={t('archivedEmptyTitle')}
          description={t('archivedEmptyDescription')}
          icon={<span aria-hidden className="text-2xl">📦</span>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              <Skeleton className="h-[132px] rounded-sm" />
              <Skeleton className="h-[132px] rounded-sm" />
              <Skeleton className="h-[132px] rounded-sm" />
            </>
          ) : (
            <>
              {visibleProjects.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className={CARD}
                  onClick={() => onOpenProject(p.id)}
                  onKeyDown={onEnterOrSpace(() => onOpenProject(p.id))}
                >
                  {/* kebab — 카드 우상단. 클릭/키 이벤트를 카드로 흘리지 않게
                      래퍼에서 stopPropagation (아니면 메뉴 열기가 프로젝트도 연다). */}
                  <div
                    className="absolute right-2 top-2"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <DropdownMenu
                      align="end"
                      items={menuItems(p)}
                      trigger={({ open, onClick, ...aria }) => (
                        <IconButton
                          {...aria}
                          data-open={open}
                          aria-label={t('projectMenu')}
                          variant="ghost"
                          size="sm"
                          onClick={onClick}
                        >
                          <span aria-hidden>⋯</span>
                        </IconButton>
                      )}
                    />
                  </div>
                  {/* 정보 계층: 제목 → 메타(문서 수 · 최근 수정) → 설명 → 태그칩.
                      태그는 읽기전용 칩(라벨만) — 편집은 kebab "편집" 모달로 이동. */}
                  <div className="min-w-0 w-full pr-8">
                    <div className="truncate text-lg font-semibold text-ink-2">
                      {p.name}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-mute-soft tabular-nums">
                      <span>{t('documentCount', { count: p.document_count })}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {t('updatedAt', {
                          time: relativeTime(p.updated_at, locale),
                        })}
                      </span>
                    </div>
                    {p.description && (
                      <div className="mt-2 line-clamp-2 text-sm text-mute-soft">
                        {p.description}
                      </div>
                    )}
                    {p.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.tags.map((tag, idx) => (
                          <span
                            key={`${tag}-${idx}`}
                            className="inline-flex items-center rounded-xs bg-amore-bg px-2 py-0.5 text-xs text-amore"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* "+ 새 프로젝트" 타일은 활성 탭에서만. 보관 탭에서 생성 유도 X. */}
              {tab === 'active' && (
                <div
                  role="button"
                  tabIndex={0}
                  className={`${CARD} min-h-[132px] items-center justify-center border-dashed text-mute hover:text-ink`}
                  onClick={() => setCreateOpen(true)}
                  onKeyDown={onEnterOrSpace(() => setCreateOpen(true))}
                >
                  <span className="text-lg font-semibold">
                    + {t('newProject')}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {/* Mount only while a target is set so name state re-inits per project. */}
      {renameTarget && (
        <RenameProjectModal
          initialName={renameTarget.name}
          initialDescription={renameTarget.description}
          initialTags={renameTarget.tags}
          suggestions={tagSuggestions}
          onClose={() => setRenameTarget(null)}
          onSave={handleEditSave}
        />
      )}

      {/* 삭제 confirm — cascade (파일/청크/검색이력 전부 영구 삭제) 이므로 필수. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={t('deleteTitle')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-md leading-[1.6] text-mute">{t('deleteBody')}</p>
      </Modal>

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
