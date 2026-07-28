'use client';

import { useMemo, useState, type UIEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type {
  DeliverableFeature,
  DeliverableRow,
  DeliverableStatus,
} from '@/lib/artifacts/types';
import { SORT_FIELDS, type SortField, type ViewMode } from './constants';
import { useDeliverables } from './use-deliverables';
import { LibraryShell } from './library-shell';
import { FilterRail } from './filter-rail';
import { DeliverableListRow } from './deliverable-list-row';
import { DeliverableGridCard } from './deliverable-grid-card';
import { BulkBar } from './bulk-bar';
import { Pressable, SelectBox } from './pressable';
import {
  LibraryEmpty,
  LibraryError,
  LibraryFilteredEmpty,
  LibrarySkeleton,
} from './library-states';

const rowKey = (r: DeliverableRow) => `${r.feature}:${r.id}`;

// Container — owns filter/view/sort/selection state, consumes the fetch hook,
// and composes the dumb presentation components. All feature knowledge stays
// in constants.ts; nothing here branches on `feature` for layout.

export function LibraryClient({
  projects,
  hasOrg,
}: {
  projects: { id: string; name: string }[];
  hasOrg: boolean;
}) {
  const t = useTranslations('Library');

  const [feature, setFeature] = useState<DeliverableFeature | null>(null);
  const [status, setStatus] = useState<DeliverableStatus | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortField>('updated');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { rows, facets, hasMore, loading, loadingMore, error, loadMore, reload } =
    useDeliverables({ feature, status, projectId, q });

  // Filtered total from facets (faceted semantics): by_status is already
  // feature/project/q-scoped, so its sum (or the single status bucket) is the
  // count of everything matching the active filters.
  const total = status
    ? facets.by_status[status] ?? 0
    : Object.values(facets.by_status).reduce((a, b) => a + b, 0);

  // Client-side sort over the loaded window. The API paginates by created_at,
  // so 'updated'/'title' reorder only what's loaded — acceptable for the
  // in-view set; 'updated' ≈ server order for most rows.
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    if (sort === 'title') copy.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') copy.sort((a, b) => cmpDesc(a.created_at, b.created_at));
    else copy.sort((a, b) => cmpDesc(a.updated_at, b.updated_at));
    return copy;
  }, [rows, sort]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected],
  );
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));

  function toggle(r: DeliverableRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = rowKey(r);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (rows.length > 0 && rows.every((r) => prev.has(rowKey(r)))) return new Set();
      return new Set(rows.map(rowKey));
    });
  }
  const clearSelection = () => setSelected(new Set());
  function refresh() {
    clearSelection();
    reload();
  }

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240 && hasMore && !loadingMore) {
      loadMore();
    }
  }

  // Active-filter chips for the filtered-empty state (each removable).
  const chips = useMemo(() => {
    const out: { key: string; label: string; onRemove: () => void }[] = [];
    if (feature) out.push({ key: 'f', label: t(`feature.${feature}`), onRemove: () => setFeature(null) });
    if (status) out.push({ key: 's', label: t(`status.${status}`), onRemove: () => setStatus(null) });
    if (projectId) {
      const name = projects.find((p) => p.id === projectId)?.name ?? projectId;
      out.push({ key: 'p', label: name, onRemove: () => setProjectId(null) });
    }
    if (q.trim()) out.push({ key: 'q', label: `“${q.trim()}”`, onRemove: () => setQ('') });
    return out;
  }, [feature, status, projectId, q, projects, t]);

  function clearAll() {
    setFeature(null);
    setStatus(null);
    setProjectId(null);
    setQ('');
  }

  const hasFilters = Boolean(feature || status || projectId || q.trim());

  // ── header slots ────────────────────────────────────────────────────────
  const search = (
    <div className="flex max-w-[400px] flex-1 items-center gap-2.5 rounded-field border-[1.5px] border-ink bg-paper px-3.5 py-2">
      <span className="text-lg text-mute-soft">🔍</span>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        className="!rounded-none !border-0 !bg-transparent !px-0 !py-0 !text-lg focus-visible:!border-transparent"
      />
    </div>
  );

  const sortTrigger = (
    <Pressable
      onPress={() => setSort((s) => SORT_FIELDS[(SORT_FIELDS.indexOf(s) + 1) % SORT_FIELDS.length])}
      ariaLabel={t('sort.label')}
      className="inline-flex shrink-0 items-stretch overflow-hidden rounded-control border-[1.5px] border-ink bg-paper shadow-memphis-sm"
    >
      <span className="flex items-center gap-1.5 px-3 py-2 text-md font-bold text-ink">
        ↕ {t(`sort.${sort}`)}
      </span>
      <span className="w-[1.5px] bg-ink" />
      <span className="flex items-center px-2.5 text-xs text-ink">▼</span>
    </Pressable>
  );

  const viewToggle = (
    <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-control border-[1.5px] border-ink bg-paper shadow-memphis-sm">
      <Pressable
        onPress={() => setView('list')}
        ariaLabel={t('view.list')}
        className={`flex w-[38px] items-center justify-center py-2 ${
          view === 'list' ? 'bg-ink text-paper' : 'text-mute'
        }`}
      >
        ☰
      </Pressable>
      <span className="w-[1.5px] bg-ink" />
      <Pressable
        onPress={() => setView('grid')}
        ariaLabel={t('view.grid')}
        className={`flex w-[38px] items-center justify-center py-2 ${
          view === 'grid' ? 'bg-ink text-paper' : 'text-mute'
        }`}
      >
        ▦
      </Pressable>
    </span>
  );

  // ── list column body ────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (loading) {
    body = <LibrarySkeleton />;
  } else if (error) {
    body = <LibraryError onRetry={reload} />;
  } else if (rows.length === 0) {
    body = hasFilters ? (
      <LibraryFilteredEmpty total={total} chips={chips} onClear={clearAll} />
    ) : (
      <LibraryEmpty />
    );
  } else if (view === 'grid') {
    body = (
      <div className="grid grid-cols-4 gap-4 p-6">
        {sortedRows.map((r) => (
          <DeliverableGridCard
            key={rowKey(r)}
            row={r}
            selected={selected.has(rowKey(r))}
            onToggleSelect={() => toggle(r)}
            hasOrg={hasOrg}
            projects={projects}
            onChanged={refresh}
          />
        ))}
        {loadingMore && <div className="col-span-4 py-4 text-center text-sm text-mute-soft">···</div>}
      </div>
    );
  } else {
    body = (
      <>
        {sortedRows.map((r) => (
          <DeliverableListRow
            key={rowKey(r)}
            row={r}
            selected={selected.has(rowKey(r))}
            onToggleSelect={() => toggle(r)}
            hasOrg={hasOrg}
            projects={projects}
            onChanged={refresh}
          />
        ))}
        {loadingMore && <div className="py-4 text-center text-sm text-mute-soft">···</div>}
      </>
    );
  }

  const showListHeader = view === 'list' && !loading && !error && rows.length > 0;

  return (
    <LibraryShell title={t('title')} count={total} search={search} sort={sortTrigger} view={viewToggle} rail={
      <FilterRail
        featureFacets={facets.by_feature}
        statusFacets={facets.by_status}
        projects={projects}
        selectedFeature={feature}
        selectedStatus={status}
        selectedProject={projectId}
        onFeature={setFeature}
        onStatus={setStatus}
        onProject={setProjectId}
      />
    }>
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedRows.length > 0 && (
          <div className="shrink-0 border-b border-line bg-paper px-5 py-2.5">
            <BulkBar
              selected={selectedRows}
              hasOrg={hasOrg}
              projects={projects}
              onClear={clearSelection}
              onChanged={refresh}
            />
          </div>
        )}

        {showListHeader && (
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-paper px-5 py-2.5">
            <SelectBox
              checked={allLoadedSelected}
              onToggle={toggleAll}
              ariaLabel={t('col.deliverable')}
              boxClassName="h-[15px] w-[15px] rounded-xs border-[1.6px]"
            />
            <span className="font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
              {t('col.deliverable')}
            </span>
            <div className="flex-1" />
            <span className="w-[120px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
              {t('col.status')}
            </span>
            <span className="w-[104px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
              {t('col.updated')}
            </span>
            <span className="w-[214px] text-right font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
              {t('col.actions')}
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" onScroll={onScroll}>
          {body}
        </div>

        <div className="shrink-0 border-t border-line bg-paper-soft px-5 py-2.5 font-mono-label text-sm text-mute-soft">
          {t('footer.summary', { shown: rows.length, total })} ·{' '}
          {t('footer.sortedBy', { field: t(`sort.${sort}`) })}
        </div>
      </div>
    </LibraryShell>
  );
}

function cmpDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
