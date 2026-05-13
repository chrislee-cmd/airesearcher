'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { FeatureKey } from '@/lib/features';
import type { WorkspaceArtifact } from '@/lib/workspace';
import { triggerBlobDownload } from '@/lib/export/download';
import { useWorkspace } from './workspace-provider';

const MIME_SINGLE = 'application/x-workspace-artifact';
const MIME_MANY = 'application/x-workspace-artifacts';

// Window for the new-row flash + trigger pulse after addArtifact fires.
const FLASH_MS = 2400;

type DownloadFormat = 'md' | 'txt' | 'html' | 'docx';

// Reports stream HTML; every other artifact is plain markdown/text. `docx`
// works for both kinds via the /api/workspace/export-docx server route
// (keeps the docx lib out of the client bundle).
function formatsFor(featureKey: FeatureKey): DownloadFormat[] {
  if (featureKey === 'reports') return ['html', 'txt', 'docx'];
  return ['md', 'txt', 'docx'];
}

const FORMAT_MIME: Record<DownloadFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').slice(0, 80).trim() || 'artifact';
}

async function downloadArtifact(a: WorkspaceArtifact, format: DownloadFormat) {
  const filename = `${sanitizeFilename(a.title)}.${format}`;

  if (format === 'docx') {
    const res = await fetch('/api/workspace/export-docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: a.title,
        content: a.content,
        kind: a.featureKey === 'reports' ? 'html' : 'md',
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    triggerBlobDownload(blob, filename);
    return;
  }

  const isHtmlSource = a.featureKey === 'reports';
  const content =
    format === 'txt' && isHtmlSource ? stripHtmlToText(a.content) : a.content;
  const blob = new Blob([content], { type: FORMAT_MIME[format] });
  triggerBlobDownload(blob, filename);
}

type Project = { id: string; name: string };

export function WorkspacePanel() {
  const t = useTranslations('Workspace');
  const tSidebar = useTranslations('Sidebar');
  const tDashboard = useTranslations('Dashboard');
  const tExport = useTranslations('Common.export');
  const {
    artifacts,
    isOpen,
    setOpen,
    removeArtifact,
    removeArtifacts,
    setProjectId,
    sendTo,
    sendMany,
    targetsFor,
    setDragging,
    lastAddedId,
    lastAddedAt,
  } = useWorkspace();
  const router = useRouter();

  const [openMenu, setOpenMenu] = useState<string | 'bulk' | null>(null);
  const [openSendSub, setOpenSendSub] = useState(false);
  const [openDownloadSub, setOpenDownloadSub] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [pulse, setPulse] = useState(false);
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

  // Click-outside to close menus.
  useEffect(() => {
    if (!openMenu) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSendSub(false);
        setOpenDownloadSub(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenu]);

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Trigger-button pulse on new artifact.
  useEffect(() => {
    if (!lastAddedAt) return;
    setPulse(true);
    const id = window.setTimeout(() => setPulse(false), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [lastAddedAt]);

  // Escape closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen]);

  // Lazy-fetch projects when modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/projects', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setProjects((json.projects ?? []) as Project[]);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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
    if (path) {
      setOpen(false);
      router.push(path);
    }
  }

  function onSendBulk(target: FeatureKey) {
    const ids = Array.from(selected);
    const path = sendMany(ids, target);
    setOpenMenu(null);
    setOpenSendSub(false);
    if (path) {
      setOpen(false);
      router.push(path);
    }
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

  async function onAssignProject(
    artifact: WorkspaceArtifact,
    nextProjectId: string | null,
  ) {
    setProjectId(artifact.id, nextProjectId);
    if (artifact.dbFeature && artifact.dbId) {
      try {
        await fetch('/api/artifacts/assign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            feature: artifact.dbFeature,
            id: artifact.dbId,
            project_id: nextProjectId,
          }),
        });
      } catch {
        // local state already updated; treat as best-effort
      }
    }
  }

  // Formats common to every selected artifact — mirrors bulkTargets so the
  // submenu only offers conversions that work for the entire selection.
  // For a mixed md+html selection the intersection collapses to {txt}.
  const bulkFormats = useMemo<DownloadFormat[]>(() => {
    if (selected.size === 0) return [];
    const sources = artifacts.filter((a) => selected.has(a.id));
    if (sources.length === 0) return [];
    const sets = sources.map((a) => new Set(formatsFor(a.featureKey)));
    const [first, ...rest] = sets;
    const intersect: DownloadFormat[] = [];
    for (const f of first) {
      if (rest.every((s) => s.has(f))) intersect.push(f);
    }
    return intersect;
  }, [artifacts, selected]);

  // Bulk send-to intersection (unchanged from previous version).
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

  const viewedArtifact = viewing ? artifacts.find((a) => a.id === viewing) : null;
  const allSelected = selected.size > 0 && selected.size === artifacts.length;
  const flashActive = !!lastAddedAt && Date.now() - lastAddedAt < FLASH_MS;
  // The trigger badge surfaces "stuff that needs your attention" — i.e.
  // unfiled artifacts. Items already in a project are out of frame.
  const unfiledCount = artifacts.filter((a) => !a.projectId).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('expand')}
        className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 border bg-paper px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.22em] transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:4px] ${
          pulse ? 'workspace-trigger-pulse border-amore text-ink-2' : 'border-line text-mute'
        }`}
      >
        <span className="inline-block h-1 w-5 bg-amore" />
        {t('eyebrow')}
        <span className="tabular-nums text-mute-soft">· {unfiledCount}</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              setOpenMenu(null);
              setViewing(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[80vh] w-full max-w-[640px] flex-col border border-line bg-paper [border-radius:4px]"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
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

            {artifacts.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-b border-line-soft px-5 py-2 text-[11px]">
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
                        setOpenDownloadSub(false);
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
                        <div className="relative">
                          <MenuItem
                            disabled={bulkFormats.length === 0}
                            onClick={() => setOpenDownloadSub((v) => !v)}
                            trailing={bulkFormats.length > 0 ? '›' : undefined}
                          >
                            {t('downloadSelected')}
                          </MenuItem>
                          {openDownloadSub && bulkFormats.length > 0 && (
                            <div className="absolute right-full top-0 mr-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:4px]">
                              {bulkFormats.map((fmt) => (
                                <MenuItem
                                  key={fmt}
                                  trailing={`.${fmt}`}
                                  onClick={() => {
                                    setOpenMenu(null);
                                    setOpenDownloadSub(false);
                                    void (async () => {
                                      for (const id of selected) {
                                        const a = artifacts.find((x) => x.id === id);
                                        if (a) await downloadArtifact(a, fmt);
                                      }
                                    })();
                                  }}
                                >
                                  {tExport(fmt)}
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

            <div className="min-h-[180px] flex-1 overflow-y-auto">
              {artifacts.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-[12px] text-mute-soft">{t('empty')}</p>
                  <p className="mt-2 text-[11px] text-mute-soft">{t('emptyHint')}</p>
                </div>
              ) : (
                <ul>
                  {artifacts.map((a) => {
                    const targets = targetsFor(a.featureKey);
                    const isMenuOpen = openMenu === a.id;
                    const isSelected = selected.has(a.id);
                    const isFresh = flashActive && lastAddedId === a.id;
                    return (
                      <li
                        key={a.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          const ids =
                            isSelected && selected.size > 1
                              ? Array.from(selected)
                              : [a.id];
                          if (ids.length > 1) {
                            e.dataTransfer.setData(MIME_MANY, JSON.stringify(ids));
                          }
                          e.dataTransfer.setData(MIME_SINGLE, a.id);
                          setDragging({
                            artifactId: a.id,
                            sourceFeature: a.featureKey,
                          });
                        }}
                        onDragEnd={() => setDragging(null)}
                        className={`cursor-grab border-b border-line-soft px-5 py-2.5 last:border-b-0 active:cursor-grabbing ${
                          isSelected ? 'bg-paper-soft' : ''
                        } ${isFresh ? 'workspace-row-flash' : ''}`}
                      >
                        <div className="flex items-center gap-3">
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
                          <select
                            value={a.projectId ?? '__unfiled__'}
                            onChange={(e) => {
                              const v = e.target.value;
                              void onAssignProject(a, v === '__unfiled__' ? null : v);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-[140px] shrink-0 truncate border border-line bg-paper px-2 py-1 text-[11px] text-mute-soft transition-colors hover:text-ink-2 [border-radius:4px]"
                            aria-label={t('assignProject')}
                          >
                            <option value="__unfiled__">{tDashboard('unfiled')}</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <div
                            className="relative shrink-0"
                            ref={isMenuOpen ? menuRef : undefined}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenu(isMenuOpen ? null : a.id);
                                setOpenSendSub(false);
                                setOpenDownloadSub(false);
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
                                    onClick={() => setOpenDownloadSub((v) => !v)}
                                    trailing="›"
                                  >
                                    {t('download')}
                                  </MenuItem>
                                  {openDownloadSub && (
                                    <div className="absolute right-full top-0 mr-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:4px]">
                                      {formatsFor(a.featureKey).map((fmt) => (
                                        <MenuItem
                                          key={fmt}
                                          trailing={`.${fmt}`}
                                          onClick={() => {
                                            setOpenMenu(null);
                                            setOpenDownloadSub(false);
                                            void downloadArtifact(a, fmt);
                                          }}
                                        >
                                          {tExport(fmt)}
                                        </MenuItem>
                                      ))}
                                    </div>
                                  )}
                                </div>
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
              <div className="border-t border-line-soft px-5 py-2 text-[11px] text-mute">
                {toast}
              </div>
            )}
          </div>

          {viewedArtifact && (
            <ViewerOverlay
              title={viewedArtifact.title}
              content={viewedArtifact.content}
              onClose={() => setViewing(null)}
            />
          )}
        </div>
      )}
    </>
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
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
