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
import type { WorkspaceArtifact, WorkspaceFolder } from '@/lib/workspace';
import { triggerBlobDownload } from '@/lib/export/download';
import { useActiveProject } from './active-project-provider';
import { useWorkspace, type WorkspaceScope } from './workspace-provider';

const MIME_SINGLE = 'application/x-workspace-artifact';
const MIME_MANY = 'application/x-workspace-artifacts';

const FLASH_MS = 2400;

type DownloadFormat = 'md' | 'txt' | 'html' | 'docx';

// Reports stream HTML; every other artifact is plain markdown/text. `docx`
// works for both kinds via the /api/workspace/export-docx server route.
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

export function WorkspacePanel() {
  const t = useTranslations('Workspace');
  const tSidebar = useTranslations('Sidebar');
  const tDashboard = useTranslations('Dashboard');
  const tExport = useTranslations('Common.export');
  const {
    artifacts,
    loading,
    isOpen,
    setOpen,
    scope,
    setScope,
    resolvedKind,
    refresh,
    removeArtifact,
    removeArtifacts,
    setProjectId,
    fetchContent,
    sendTo,
    sendMany,
    targetsFor,
    setDragging,
    selectedFolderId,
    setSelectedFolderId,
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    setFolderId,
  } = useWorkspace();
  const { projects, active, setActive } = useActiveProject();
  const router = useRouter();

  const [openMenu, setOpenMenu] = useState<string | 'bulk' | null>(null);
  const [openSendSub, setOpenSendSub] = useState(false);
  const [openDownloadSub, setOpenDownloadSub] = useState(false);
  const [viewing, setViewing] = useState<WorkspaceArtifact | null>(null);
  const [viewingContent, setViewingContent] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  // Folder creation/rename state lives in the panel — provider just owns
  // the list + persistence.
  const [creatingFolderParent, setCreatingFolderParent] = useState<
    string | null | undefined
  >(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTargetFolder, setDropTargetFolder] = useState<string | 'root' | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevArtifactCountRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When a workspace artifact is in-flight, prevent the browser from
  // showing a "forbidden" cursor over parts of the page that don't have
  // their own dragover handlers (e.g. the main content area between the
  // two sidebars). Drop is still gated by per-element onDrop handlers.
  useEffect(() => {
    function onGlobalDragOver(e: DragEvent) {
      if (
        e.dataTransfer?.types.some(
          (t) =>
            t === 'application/x-workspace-artifact' ||
            t === 'application/x-workspace-artifacts',
        )
      ) {
        e.preventDefault();
      }
    }
    document.addEventListener('dragover', onGlobalDragOver);
    return () => document.removeEventListener('dragover', onGlobalDragOver);
  }, []);

  // Drop stale selections (artifact left current scope or was deleted).
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

  // Trigger-button pulse when artifact count grows.
  useEffect(() => {
    if (artifacts.length > prevArtifactCountRef.current) {
      setPulse(true);
      const id = window.setTimeout(() => setPulse(false), FLASH_MS);
      prevArtifactCountRef.current = artifacts.length;
      return () => window.clearTimeout(id);
    }
    prevArtifactCountRef.current = artifacts.length;
  }, [artifacts.length]);

  // Escape closes the sidebar.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setViewing(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen]);

  // Focus the inline project-name input when create mode opens.
  useEffect(() => {
    if (creatingProject) inputRef.current?.focus();
  }, [creatingProject]);

  // Lazy-load the view modal content when an artifact opens.
  useEffect(() => {
    if (!viewing) {
      setViewingContent(null);
      return;
    }
    let cancelled = false;
    setViewingContent(null);
    void fetchContent(viewing).then((res) => {
      if (cancelled) return;
      setViewingContent(res?.content ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [viewing, fetchContent]);

  function flash(msg: string) {
    setToast(msg);
  }

  async function onCopy(a: WorkspaceArtifact) {
    setOpenMenu(null);
    const c = await fetchContent(a);
    if (!c) {
      flash(t('copyFailed'));
      return;
    }
    try {
      await navigator.clipboard.writeText(c.content);
      flash(t('copied'));
    } catch {
      flash(t('copyFailed'));
    }
  }

  async function downloadArtifact(a: WorkspaceArtifact, format: DownloadFormat) {
    const c = await fetchContent(a);
    if (!c) return;
    const filename = `${sanitizeFilename(a.title)}.${format}`;

    if (format === 'docx') {
      const res = await fetch('/api/workspace/export-docx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: a.title,
          content: c.content,
          kind: c.kind === 'html' ? 'html' : 'md',
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      return;
    }

    const content =
      format === 'txt' && c.kind === 'html' ? stripHtmlToText(c.content) : c.content;
    const blob = new Blob([content], { type: FORMAT_MIME[format] });
    triggerBlobDownload(blob, filename);
  }

  async function onSend(a: WorkspaceArtifact, target: FeatureKey) {
    setOpenMenu(null);
    setOpenSendSub(false);
    const path = await sendTo(a.id, target);
    if (path) {
      setOpen(false);
      router.push(path);
    }
  }

  async function onSendBulk(target: FeatureKey) {
    setOpenMenu(null);
    setOpenSendSub(false);
    const path = await sendMany(Array.from(selected), target);
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

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        flash(t('createFailed'));
        return;
      }
      const json = await res.json();
      const created = { id: json.id as string, name: json.name as string };
      // Switch the workspace + the global active project to the new one so
      // the panel opens straight into it.
      setActive(created);
      setScope('active');
      setCreatingProject(false);
      setNewProjectName('');
      flash(t('created'));
    } catch {
      flash(t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Build a flat depth-ordered list from the folder rows so the panel can
  // render the tree with simple left-padding by depth. Cycles are
  // server-prevented; the depth cap (8) is a defensive backstop.
  type FolderNode = { folder: WorkspaceFolder; depth: number };
  const folderTree = useMemo<FolderNode[]>(() => {
    const byParent = new Map<string | null, WorkspaceFolder[]>();
    for (const f of folders) {
      const key = f.parentFolderId;
      const list = byParent.get(key) ?? [];
      list.push(f);
      byParent.set(key, list);
    }
    const out: FolderNode[] = [];
    function walk(parent: string | null, depth: number) {
      if (depth > 8) return;
      const children = (byParent.get(parent) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const f of children) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [folders]);

  async function submitFolderCreate() {
    const name = newFolderName.trim();
    if (!name || creatingFolderParent === undefined) return;
    setBusy(true);
    try {
      const created = await createFolder(name, creatingFolderParent);
      if (created) {
        setSelectedFolderId(created.id);
        flash(t('folderCreated'));
      } else {
        flash(t('folderCreateFailed'));
      }
    } finally {
      setBusy(false);
      setCreatingFolderParent(undefined);
      setNewFolderName('');
    }
  }

  async function submitFolderRename(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingFolder(null);
      return;
    }
    await renameFolder(id, name);
    setRenamingFolder(null);
    setRenameValue('');
  }

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

  const allSelected = selected.size > 0 && selected.size === artifacts.length;
  const showAssignSelect = resolvedKind !== 'all'; // 'all' view shows the project name in-row instead
  const flashActive = pulse;
  const unfiledCount = artifacts.filter((a) => !a.projectId).length;

  return (
    <>
      {/* Floating trigger — fades out as sidebar opens */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('expand')}
        className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 border bg-paper px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.22em] transition duration-[180ms] hover:border-amore hover:text-ink-2 [border-radius:14px] ${
          pulse ? 'workspace-trigger-pulse border-amore text-ink-2' : 'border-line text-mute'
        } ${isOpen ? 'pointer-events-none translate-y-1 opacity-0' : 'opacity-100 translate-y-0'}`}
      >
        <span className="inline-block h-1 w-5 bg-amore" />
        {t('eyebrow')}
        <span className="tabular-nums text-mute-soft">· {unfiledCount}</span>
      </button>

      {/* Right sidebar — width animates 0 → 288px so main content smoothly shifts */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 overflow-hidden transition-[width] duration-[200ms] ease-out md:flex ${
          isOpen ? 'w-[288px]' : 'w-0'
        }`}
      >
        {/* Inner panel fixed at 288px — clipped by aside's overflow-hidden during transition */}
        <div className="flex h-full w-[288px] flex-col border-l border-line-soft bg-paper [box-shadow:-8px_0_32px_0_rgba(0,0,0,0.14)]">
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

          {/* Scope row — project switcher + create button. The
              workspace IS the project view: switching scope here is
              the same operation as switching the active project. */}
          <div className="flex items-center gap-2 border-b border-line-soft px-5 py-2">
            {creatingProject ? (
              <>
                <input
                  ref={inputRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createProject();
                    if (e.key === 'Escape') {
                      setCreatingProject(false);
                      setNewProjectName('');
                    }
                  }}
                  placeholder={t('newProjectName')}
                  className="flex-1 border border-line bg-paper px-2 py-1 text-[12px] text-ink-2 [border-radius:4px]"
                />
                <button
                  type="button"
                  disabled={busy || !newProjectName.trim()}
                  onClick={() => void createProject()}
                  className="border border-line bg-paper px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
                >
                  {t('create')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingProject(false);
                    setNewProjectName('');
                  }}
                  className="text-[11px] text-mute-soft hover:text-ink-2"
                >
                  {t('cancel')}
                </button>
              </>
            ) : (
              <>
                <select
                  value={scope}
                  onChange={(e) => {
                    const v = e.target.value as WorkspaceScope;
                    if (v === '__new__') {
                      setCreatingProject(true);
                      return;
                    }
                    setScope(v);
                    // Keep useActiveProject in sync when the user
                    // picks a real project from the dropdown.
                    if (v !== 'all' && v !== 'unfiled' && v !== 'active') {
                      const p = projects.find((x) => x.id === v);
                      if (p) setActive(p);
                    }
                  }}
                  className="flex-1 border border-line bg-paper px-2 py-1 text-[12px] text-ink-2 [border-radius:4px]"
                >
                  <option value="active">
                    {active
                      ? `${t('scopeProject')}: ${active.name}`
                      : t('scopeUnfiled')}
                  </option>
                  <option value="unfiled">{t('scopeUnfiled')}</option>
                  <option value="all">{t('scopeAll')}</option>
                  {projects.length > 0 && (
                    <optgroup label={t('projects')}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__new__">{t('newProject')}</option>
                </select>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="border border-line bg-paper px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:4px]"
                >
                  {t('refresh')}
                </button>
              </>
            )}
          </div>

          {resolvedKind === 'project' && (
            <div className="border-b border-line-soft px-5 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
                  {t('folders')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolderParent(null);
                    setNewFolderName('');
                  }}
                  className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:text-amore"
                >
                  + {t('newFolder')}
                </button>
              </div>
              <ul>
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropTargetFolder('root');
                    }}
                    onDragLeave={() => setDropTargetFolder((v) => (v === 'root' ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTargetFolder(null);
                      const id = e.dataTransfer.getData(MIME_SINGLE);
                      const many = e.dataTransfer.getData(MIME_MANY);
                      const ids = many ? (JSON.parse(many) as string[]) : id ? [id] : [];
                      for (const aid of ids) {
                        const a = artifacts.find((x) => x.id === aid);
                        if (a) void setFolderId(a, null);
                      }
                    }}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] [border-radius:4px] ${
                      selectedFolderId === null
                        ? 'bg-paper-soft text-ink-2'
                        : 'text-mute hover:text-ink-2'
                    } ${dropTargetFolder === 'root' ? 'outline outline-1 outline-amore' : ''}`}
                  >
                    <span>📁</span>
                    <span>{t('folderRoot')}</span>
                  </button>
                </li>
                {folderTree.map(({ folder, depth }) => {
                  const isSelected = selectedFolderId === folder.id;
                  const isDropTarget = dropTargetFolder === folder.id;
                  const isRenaming = renamingFolder === folder.id;
                  return (
                    <li key={folder.id}>
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDropTargetFolder(folder.id);
                        }}
                        onDragLeave={() => setDropTargetFolder((v) => (v === folder.id ? null : v))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetFolder(null);
                          const id = e.dataTransfer.getData(MIME_SINGLE);
                          const many = e.dataTransfer.getData(MIME_MANY);
                          const ids = many ? (JSON.parse(many) as string[]) : id ? [id] : [];
                          for (const aid of ids) {
                            const a = artifacts.find((x) => x.id === aid);
                            if (a) void setFolderId(a, folder.id);
                          }
                        }}
                        className={`flex items-center gap-1 [border-radius:4px] ${
                          isSelected ? 'bg-paper-soft' : ''
                        } ${isDropTarget ? 'outline outline-1 outline-amore' : ''}`}
                        style={{ paddingLeft: `${depth * 14 + 8}px` }}
                      >
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => void submitFolderRename(folder.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void submitFolderRename(folder.id);
                              if (e.key === 'Escape') {
                                setRenamingFolder(null);
                                setRenameValue('');
                              }
                            }}
                            className="flex-1 border border-line bg-paper px-1.5 py-0.5 text-[12px] text-ink-2 [border-radius:4px]"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedFolderId(folder.id)}
                            onDoubleClick={() => {
                              setRenamingFolder(folder.id);
                              setRenameValue(folder.name);
                            }}
                            className={`flex flex-1 items-center gap-2 py-1 text-left text-[12px] ${
                              isSelected ? 'text-ink-2' : 'text-mute hover:text-ink-2'
                            }`}
                          >
                            <span>📁</span>
                            <span className="truncate">{folder.name}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingFolderParent(folder.id);
                            setNewFolderName('');
                          }}
                          aria-label={t('newFolder')}
                          className="px-1.5 py-0.5 text-[12px] text-mute-soft hover:text-ink-2"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(t('confirmDeleteFolder', { name: folder.name }))) {
                              void deleteFolder(folder.id);
                            }
                          }}
                          aria-label={t('deleteFolder')}
                          className="pr-2 text-[12px] text-mute-soft hover:text-warning"
                        >
                          ×
                        </button>
                      </div>
                      {creatingFolderParent === folder.id && (
                        <div
                          className="flex items-center gap-2 py-1"
                          style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
                        >
                          <input
                            autoFocus
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void submitFolderCreate();
                              if (e.key === 'Escape') {
                                setCreatingFolderParent(undefined);
                                setNewFolderName('');
                              }
                            }}
                            placeholder={t('folderName')}
                            className="flex-1 border border-line bg-paper px-1.5 py-0.5 text-[12px] text-ink-2 [border-radius:4px]"
                          />
                          <button
                            type="button"
                            disabled={busy || !newFolderName.trim()}
                            onClick={() => void submitFolderCreate()}
                            className="border border-line bg-paper px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
                          >
                            {t('create')}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
                {creatingFolderParent === null && (
                  <li className="flex items-center gap-2 py-1 pl-2">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitFolderCreate();
                        if (e.key === 'Escape') {
                          setCreatingFolderParent(undefined);
                          setNewFolderName('');
                        }
                      }}
                      placeholder={t('folderName')}
                      className="flex-1 border border-line bg-paper px-1.5 py-0.5 text-[12px] text-ink-2 [border-radius:4px]"
                    />
                    <button
                      type="button"
                      disabled={busy || !newFolderName.trim()}
                      onClick={() => void submitFolderCreate()}
                      className="border border-line bg-paper px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 disabled:opacity-40 [border-radius:4px]"
                    >
                      {t('create')}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

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
                    className="border border-line bg-paper px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-mute transition-colors duration-[120ms] hover:border-amore hover:text-ink-2 [border-radius:14px]"
                  >
                    {t('bulkActions')}
                  </button>
                  {openMenu === 'bulk' && (
                    <div className="absolute right-0 top-full z-10 mt-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:14px]">
                      <div className="relative">
                        <MenuItem
                          disabled={bulkTargets.length === 0}
                          onClick={() => setOpenSendSub((v) => !v)}
                          trailing={bulkTargets.length > 0 ? '›' : undefined}
                        >
                          {t('sendSelectedTo')}
                        </MenuItem>
                        {openSendSub && bulkTargets.length > 0 && (
                          <div className="absolute right-full top-0 mr-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:14px]">
                            {bulkTargets.map((tgt) => (
                              <MenuItem
                                key={tgt}
                                onClick={() => void onSendBulk(tgt)}
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
                          <div className="absolute right-full top-0 mr-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:14px]">
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
                      {resolvedKind === 'project' && (
                        <>
                          <div className="my-1 h-px bg-line-soft" />
                          <MenuItem
                            danger
                            onClick={() => {
                              const list = artifacts.filter((a) => selected.has(a.id));
                              void removeArtifacts(list);
                              setSelected(new Set());
                              setOpenMenu(null);
                            }}
                          >
                            {t('removeFromProject')}
                          </MenuItem>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && artifacts.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[12px] text-mute-soft">{t('loading')}</p>
              </div>
            ) : artifacts.length === 0 ? (
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
                  const isFresh = flashActive;
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
                      className={`cursor-grab border-b border-line-soft px-4 py-3 last:border-b-0 active:cursor-grabbing ${
                        isSelected ? 'bg-paper-soft' : ''
                      } ${isFresh ? 'workspace-row-flash' : ''}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(a.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 h-3 w-3 shrink-0 accent-amore"
                          aria-label={t('select')}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-amore">
                            {tSidebar(a.featureKey)}
                          </div>
                          <div className="mt-0.5 truncate text-[12px] text-ink-2">
                            {a.title}
                          </div>
                          {showAssignSelect && (
                            <select
                              value={a.projectId ?? '__unfiled__'}
                              onChange={(e) => {
                                const v = e.target.value;
                                void setProjectId(a, v === '__unfiled__' ? null : v).then(() => {
                                  void refresh();
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1.5 w-full truncate border border-line bg-paper px-2 py-1 text-[10.5px] text-mute-soft transition-colors hover:text-ink-2 [border-radius:14px]"
                              aria-label={t('assignProject')}
                            >
                              <option value="__unfiled__">{tDashboard('unfiled')}</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          )}
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
                              setOpenDownloadSub(false);
                            }}
                            aria-label={t('actions')}
                            className="flex h-6 w-6 items-center justify-center text-mute-soft transition-colors duration-[120ms] hover:text-ink-2"
                          >
                            <span className="text-[16px] leading-none">⋯</span>
                          </button>
                          {isMenuOpen && (
                            <div className="absolute right-0 top-full z-10 mt-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:14px]">
                              <MenuItem
                                onClick={() => {
                                  setViewing(a);
                                  setOpenMenu(null);
                                }}
                              >
                                {t('view')}
                              </MenuItem>
                              <MenuItem onClick={() => void onCopy(a)}>
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
                                  <div className="absolute right-full top-0 mr-1 min-w-[160px] border border-line bg-paper py-1 [border-radius:14px]">
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
                                  <div className="absolute right-full top-0 mr-1 min-w-[180px] border border-line bg-paper py-1 [border-radius:14px]">
                                    {targets.map((tgt) => (
                                      <MenuItem
                                        key={tgt}
                                        onClick={() => void onSend(a, tgt)}
                                      >
                                        {tSidebar(tgt)}
                                      </MenuItem>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {resolvedKind === 'project' && (
                                <>
                                  <div className="my-1 h-px bg-line-soft" />
                                  <MenuItem
                                    danger
                                    onClick={() => {
                                      void removeArtifact(a).then(() => void refresh());
                                      setOpenMenu(null);
                                    }}
                                  >
                                    {t('removeFromProject')}
                                  </MenuItem>
                                </>
                              )}
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
      </aside>

      {/* Artifact viewer — modal overlay, independent of sidebar state */}
      {viewing && (
        <ViewerOverlay
          title={viewing.title}
          content={viewingContent}
          onClose={() => setViewing(null)}
        />
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
  content: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[720px] flex-col border border-line bg-paper [border-radius:14px]"
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
          {content === null ? '…' : content}
        </pre>
      </div>
    </div>
  );
}
