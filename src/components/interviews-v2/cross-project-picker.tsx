'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';

// Cross-project search picker (사용자 결정 2026-07-03). The "🌐 전체 프로젝트
// 검색" entry used to open the cross-search chat immediately; it now opens
// this modal first so the user picks exactly which projects to search. On
// confirm we hand the selected id set up to the fullview, which opens the
// cross chat scoped to that set (backend project_ids, PR #632).
//
// Selection is local Set<string> state, reset whenever the modal reopens
// (keyed remount from the parent isn't needed — the parent unmounts on close
// via the `open` guard, but we also reset on every open to be safe).
//
// Design-system: Button / Checkbox / Modal primitives only; the per-project
// row is a plain <label> (allowed — not a native button/input/textarea) that
// wraps the Checkbox primitive so the whole card is a click target.

export function CrossProjectPicker({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  // Selected project ids (always ≥ 1 — confirm is disabled at 0).
  onConfirm: (selectedIds: string[]) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const { projects, isLoading } = useInterviewV2Projects();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const allSelected = projects.length > 0 && selected.size === projects.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allIds));
  const clearAll = () => setSelected(new Set());

  const confirm = () => {
    if (selected.size === 0) return;
    onConfirm([...selected]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('pickerTitle')}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0}
            onClick={confirm}
          >
            {t('pickerConfirm', { count: selected.size })}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 border-b border-line-soft pb-3">
        <Button
          variant="secondary"
          size="xs"
          onClick={toggleAll}
          disabled={projects.length === 0}
        >
          {t('pickerSelectAll')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={clearAll}
          disabled={selected.size === 0}
        >
          {t('pickerClearAll')}
        </Button>
        <span className="ml-auto text-xs-soft text-mute-soft tabular-nums">
          {t('pickerCount', {
            selected: selected.size,
            total: projects.length,
          })}
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="h-16 animate-pulse rounded-sm bg-line-soft/40" />
          <div className="h-16 animate-pulse rounded-sm bg-line-soft/40" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          tone="subtle"
          title={t('pickerEmptyTitle')}
          description={t('pickerEmptyDescription')}
        />
      ) : (
        <div className="grid max-h-[52vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {projects.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-start gap-3 rounded-sm border border-line-soft p-3 transition-colors hover:border-ink hover:bg-amore-bg"
            >
              <Checkbox
                className="mt-0.5"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="min-w-0">
                <span className="block truncate text-md font-semibold text-ink-2">
                  {p.name}
                </span>
                {p.description && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-mute-soft">
                    {p.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
