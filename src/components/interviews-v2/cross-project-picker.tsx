'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { TagFilterBar } from './tag-filter-bar';

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
// 태그 필터 (2026-07-06): 상단 chip row(org 태그 빈도순, project-list 와 동일한
// TagFilterBar 재사용)가 리스트에 **보이는** 프로젝트를 좁힌다. 이 필터는 view
// 축, 체크박스는 selection 축 — 둘은 별개다. "보이는 것 전체 선택"은 현재 필터로
// 좁혀진 집합만 일괄 체크하며, 필터를 바꿔도 이미 체크된(지금 숨겨진) 선택은
// 유지된다. confirm 은 항상 체크된 전체(숨김 포함) 를 넘기고, 숨김이 있으면
// 카운트에 "N개 숨김 포함" 을 명시해 실수를 막는다.
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
  const { projects, allTags, isLoading } = useInterviewV2Projects();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 선택된 태그 key(lowercase) 목록 — view filter 축 (selection 과 별개).
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const toggleTagFilter = (key: string) =>
    setTagFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  // 태그 필터로 좁혀진 리스트. 선택 0 = 전체(현행). OR 규칙 — 선택 태그 중 하나
  // 라도 가진 프로젝트만 (project-list 필터와 동일 규칙).
  const visibleProjects = useMemo(
    () =>
      tagFilter.length === 0
        ? projects
        : projects.filter((p) =>
            p.tags.some((tag) => tagFilter.includes(tag.toLowerCase())),
          ),
    [projects, tagFilter],
  );

  const visibleIds = useMemo(
    () => new Set(visibleProjects.map((p) => p.id)),
    [visibleProjects],
  );

  // 현재 보이는 것이 전부 이미 체크됐는지 — "보이는 것 전체 선택" 토글 판정.
  const visibleAllSelected =
    visibleProjects.length > 0 &&
    visibleProjects.every((p) => selected.has(p.id));

  // 체크됐지만 지금 필터로 숨겨진 선택 수 (confirm 카운트 경고용).
  const hiddenSelectedCount = useMemo(
    () => [...selected].filter((id) => !visibleIds.has(id)).length,
    [selected, visibleIds],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // "보이는 것 전체 선택" — 필터된 집합 기준. 전부 체크돼 있으면 보이는 것만
  // 해제하고, 아니면 보이는 것을 추가 체크한다. 숨겨진(다른 태그) 선택은 유지.
  const toggleVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (visibleAllSelected) {
        for (const p of visibleProjects) next.delete(p.id);
      } else {
        for (const p of visibleProjects) next.add(p.id);
      }
      return next;
    });

  const clearAll = () => setSelected(new Set());

  const confirm = () => {
    if (selected.size === 0) return;
    // 최종 선택 셋 = 체크된 전체 (숨김 포함) — 필터는 view 축이라 영향 없음.
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
      {/* 태그 필터 chip row — org 전체 태그(빈도순), OR 토글. 태그 없으면 렌더 X. */}
      <TagFilterBar
        tags={allTags}
        selected={tagFilter}
        onToggle={toggleTagFilter}
        onClear={() => setTagFilter([])}
      />

      <div className="mb-3 flex items-center gap-2 border-b border-line-soft pb-3">
        <Button
          variant="secondary"
          size="xs"
          onClick={toggleVisible}
          disabled={visibleProjects.length === 0}
        >
          {t('pickerSelectVisible')}
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
          {hiddenSelectedCount > 0 && (
            <span className="ml-1 text-amore">
              {t('pickerHiddenNote', { hidden: hiddenSelectedCount })}
            </span>
          )}
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
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          tone="subtle"
          title={t('pickerFilteredEmptyTitle')}
          description={t('pickerFilteredEmptyDescription')}
        />
      ) : (
        <div className="grid max-h-[52vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {visibleProjects.map((p) => (
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
