'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { FeatureKey } from '@/lib/features';
import { useWorkspace } from './workspace-provider';

const MIME_SINGLE = 'application/x-workspace-artifact';
const MIME_MANY = 'application/x-workspace-artifacts';

export function WorkspacePanel() {
  const t = useTranslations('Workspace');
  const tSidebar = useTranslations('Sidebar');
  const {
    artifacts,
    isOpen,
    setOpen,
    removeArtifact,
    removeArtifacts,
    sendTo,
    sendMany,
    targetsFor,
    setDragging,
  } = useWorkspace();
  const router = useRouter();

  const [openMenu, setOpenMenu] = useState<string | 'bulk' | null>(null);
  const [openSendSub, setOpenSendSub] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  // Drop selections that no longer exist (artifact deleted elsewhere).
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(artifacts.map((a) => a.id));
      const next = new Set<string>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [artifacts]);

  useEffect(() => {
    if (!openMenu) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSendSub(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenu]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1500);
    return () => window.clearTimeout(id);
  }, [toast]);

  function flash(msg: string) {
    setToast(msg);
  }

  async function onCopy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      flash(t('copied'));
    } catch {
      flash(t('copyFailed'));
    }
    setOpenMenu(null);
  }

  function onSend(artifactId: string, target: FeatureKey) {
    const path = sendTo(artifactId, target);
    setOpenMenu(null);
    setOpenSendSub(false);
    if (path) router.push(path);
  }

  function onSendBulk(target: FeatureKey) {
    const ids = Array.from(selected);
    const path = sendMany(ids, target);
    setOpenMenu(null);
    setOpenSendSub(false);
    if (path) router.push(path);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === artifacts.length
        ? new Set()
        : new Set(artifacts.map((a) => a.id)),
    );
  }

  // The intersection of compatible targets across every selected artifact's
  // source feature. Targets that aren't valid for *every* selected source
  // are filtered out so a bulk "send to" never silently drops some items.
  const bulkTargets = useMemo<FeatureKey[]>(() => {
    if (selected.size === 0) return [];
    const sources = artifacts
      .filter((a) => selected.has(a.id))
      .map((a) => a.featureKey);
    if (sources.length === 0) return [];
    const sets = sources.map((s) => new Set(targetsFor(s)));
    const [first, ...rest] = sets;
    const intersect = new Set<FeatureKey>();
    for (const k of first) {
      if (rest.every((s) => s.has(k))) intersect.add(k);
    }
    return Array.from(intersect);
  }, [artifacts, selected, targetsFor]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('expand')}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 border border-line bg-paper px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:4px]"
      >
        <span className="inline-block h-1 w-5 bg-amore" />
        {t('eyebrow')}
        <span className="tabular-nums text-mute-soft">· {artifacts.length}</span>
      </button>
    );
  }

  const viewedArtifact = viewing ? artifacts.find((a) => a.id === viewing) : null;
  const allSelected = selected.size > 0 && selected.size === artifacts.length;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col border border-line bg-paper [border-radius:4px]">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
            {t('eyebrow')}
          </span>
          <span className="text-[11px] tabular-nums text-mute-soft">
            · {artifacts.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setOpenMenu(null);
            setViewing(null);
          }}
          aria-label={t('collapse')}
          className="text-[18px] leading-none text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
        >
          ×
        </button>
      </header>

      {/* Selection toolbar — only visible when at least one item is checked,
          OR when there are items so the user has a place to start. */}
      {artifacts.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2 text-[11px]">
          <label className="flex cursor-pointer items-center gap-2 text-mute hover:text-ink-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-3 w-3 accent-amore"
            />
            <span>
              {selected.size > 0
                ? t('nSelected', { count: selected.size })
                : t('selectAll')}
            </span>
          </label>
          {selected.size > 0 && (
            <div
              className="relative"
              ref={openMenu === 'bulk' ? menuRef : undefined}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(openMenu === 'bulk' ? null : 'bulk');
                  setOpenSendSub(false);
                }}
                className="border border-line bg-paper px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:4px]"
              >
                {t('bulkActions')}
              </button>
              {openMenu === 'bulk' && (
                <div className="absolute right-0 top-full z-10 mt-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:4px]">
                  <div className="relative">
                    <MenuItem
                      disabled={bulkTargets.length === 0}
                      onClick={() => setOpenSendSub((v) => !v)}
                      trailing={bulkTargets.length > 0 ? '›' : undefined}
                    >
                      {t('sendSelectedTo')}
                    </MenuItem>
                    {openSendSub && bulkTargets.length > 0 && (
                      <div className="absolute right-full top-0 mr-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:4px]">
                        {bulkTargets.map((tgt) => (
                          <MenuItem
                            key={tgt}
                            onClick={() => onSendBulk(tgt)}
                          >
                            {tSidebar(tgt)}
                          </MenuItem>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="my-1 h-px bg-line-soft" />
                  <MenuItem
                    danger
                    onClick={() => {
                      removeArtifacts(Array.from(selected));
                      setSelected(new Set());
                      setOpenMenu(null);
                    }}
                  >
                    {t('deleteSelected')}
                  </MenuItem>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="max-h-[60vh] min-h-[180px] overflow-y-auto">
        {artifacts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] text-mute-soft">{t('empty')}</p>
            <p className="mt-2 text-[11px] text-mute-soft">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul>
            {artifacts.map((a) => {
              const targets = targetsFor(a.featureKey);
              const isMenuOpen = openMenu === a.id;
              const isSelected = selected.has(a.id);
              return (
                <li
                  key={a.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    // If the dragged item is part of a multi-selection,
                    // carry the whole set; otherwise carry just this one.
                    const ids =
                      isSelected && selected.size > 1
                        ? Array.from(selected)
                        : [a.id];
                    if (ids.length > 1) {
                      e.dataTransfer.setData(MIME_MANY, JSON.stringify(ids));
                    }
                    // Always set single MIME so legacy drop handlers get
                    // at least the primary item.
                    e.dataTransfer.setData(MIME_SINGLE, a.id);
                    setDragging({
                      artifactId: a.id,
                      sourceFeature: a.featureKey,
                    });
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`cursor-grab border-b border-line-soft px-4 py-2.5 last:border-b-0 active:cursor-grabbing ${
                    isSelected ? 'bg-paper-soft' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3 w-3 shrink-0 accent-amore"
                      aria-label={t('select')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore">
                        {tSidebar(a.featureKey)}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
                        {a.title}
                      </div>
                    </div>
                    <div
                      className="relative shrink-0"
                      ref={isMenuOpen ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(isMenuOpen ? null : a.id);
                          setOpenSendSub(false);
                        }}
                        aria-label={t('actions')}
                        className="flex h-7 w-7 items-center justify-center text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
                      >
                        <span className="text-[16px] leading-none">⋯</span>
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:4px]">
                          <MenuItem
                            onClick={() => {
                              setViewing(a.id);
                              setOpenMenu(null);
                            }}
                          >
                            {t('view')}
                          </MenuItem>
                          <MenuItem onClick={() => onCopy(a.content)}>
                            {t('copy')}
                          </MenuItem>
                          <div className="relative">
                            <MenuItem
                              disabled={targets.length === 0}
                              onClick={() => setOpenSendSub((v) => !v)}
                              trailing={targets.length > 0 ? '›' : undefined}
                            >
                              {t('sendTo')}
                            </MenuItem>
                            {openSendSub && targets.length > 0 && (
                              <div className="absolute right-full top-0 mr-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:4px]">
                                {targets.map((tgt) => (
                                  <MenuItem
                                    key={tgt}
                                    onClick={() => onSend(a.id, tgt)}
                                  >
                                    {tSidebar(tgt)}
                                  </MenuItem>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="my-1 h-px bg-line-soft" />
                          <MenuItem
                            danger
                            onClick={() => {
                              removeArtifact(a.id);
                              setOpenMenu(null);
                            }}
                          >
                            {t('delete')}
                          </MenuItem>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && (
        <div className="border-t border-line-soft px-4 py-2 text-[11px] text-mute">
          {toast}
        </div>
      )}

      {viewedArtifact && (
        <ViewerOverlay
          title={viewedArtifact.title}
          content={viewedArtifact.content}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  trailing,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[11.5px] transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-warning hover:bg-paper-soft'
          : 'text-mute hover:bg-paper-soft hover:text-ink-2'
      }`}
    >
      <span>{children}</span>
      {trailing && <span className="text-mute-soft">{trailing}</span>}
    </button>
  );
}

function ViewerOverlay({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[720px] flex-col border border-line bg-paper [border-radius:4px]"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="truncate text-[13px] font-semibold text-ink-2">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] leading-none text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
          >
            ×
          </button>
        </header>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap p-5 text-[12.5px] leading-[1.7] text-ink-2">
          {content}
        </pre>
      </div>
    </div>
  );
}
