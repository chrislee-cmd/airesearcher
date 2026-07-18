'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useRequireAuth } from './auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProjectItem = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  item_count: number;
};

export function ProjectsView({
  initialProjects,
  canManage,
}: {
  initialProjects: ProjectItem[];
  canManage: boolean;
}) {
  const t = useTranslations('Projects');
  const tc = useTranslations('Common');
  const router = useRouter();
  const requireAuth = useRequireAuth();

  const [view, setView] = useState<'folder' | 'list'>('folder');
  const [projects, setProjects] = useState(initialProjects);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  function openCreate() {
    requireAuth(() => setCreating(true));
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const p = await res.json();
      setProjects([{ ...p, item_count: 0 }, ...projects]);
      setName('');
      setDescription('');
      setCreating(false);
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete project?')) return;
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProjects(projects.filter((p) => p.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="mt-8">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-line-soft pb-3">
        <ViewToggle value={view} onChange={setView} />
        {canManage && (
          <Button variant="primary" size="sm" onClick={openCreate}>
            {t('newProject')}
          </Button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={submitCreate}
          className="mt-5 border border-line bg-paper p-5 rounded-sm"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={t('name')}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <Input
              label={t('descriptionField')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setCreating(false)}
            >
              {tc('cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={busy}
            >
              {t('create')}
            </Button>
          </div>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="mt-8 border border-line bg-paper-soft p-6 text-md text-mute rounded-sm">
          {t('noProjects')}
        </div>
      ) : view === 'folder' ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {projects.map((p) => (
            <FolderCard key={p.id} project={p} onDelete={remove} canManage={canManage} />
          ))}
        </div>
      ) : (
        <div className="mt-6 border border-line bg-paper rounded-sm">
          <table className="w-full text-md">
            <thead className="border-b border-line">
              <tr>
                <Th>{t('name')}</Th>
                <Th className="w-32">{t('items')}</Th>
                <Th className="w-40">{t('createdAt')}</Th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-line-soft">
                  <td className="px-5 py-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="text-ink-2 hover:text-amore"
                    >
                      {p.name}
                    </Link>
                    {p.description && (
                      <div className="mt-0.5 text-sm text-mute-soft">
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-mute tabular-nums">{p.item_count}</td>
                  <td className="px-5 py-3 text-mute-soft tabular-nums">
                    {new Date(p.created_at).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {canManage && (
                      <Button
                        variant="destructive-link"
                        size="xs"
                        onClick={() => remove(p.id)}
                        className="!px-0 !py-0 !text-sm !font-normal uppercase tracking-[0.18em]"
                      >
                        {t('delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: 'folder' | 'list';
  onChange: (v: 'folder' | 'list') => void;
}) {
  const t = useTranslations('Projects');
  const items: { v: 'folder' | 'list'; label: string }[] = [
    { v: 'folder', label: t('folderView') },
    { v: 'list', label: t('listView') },
  ];
  return (
    <div className="inline-flex items-center gap-1 border border-line p-0.5 rounded-sm">
      {items.map((it) => (
        <Button
          key={it.v}
          variant="link"
          size="xs"
          onClick={() => onChange(it.v)}
          className={`!px-3 !py-1 !text-sm !font-normal uppercase tracking-[0.18em] [border-radius:3px] ${
            value === it.v
              ? '!bg-ink !text-paper'
              : '!text-mute hover:!text-ink-2'
          }`}
        >
          {it.label}
        </Button>
      ))}
    </div>
  );
}

function FolderCard({
  project,
  onDelete,
  canManage,
}: {
  project: ProjectItem;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  const t = useTranslations('Projects');
  return (
    <div className="group relative border border-line bg-paper-soft p-5 transition-transform duration-[120ms] hover:-translate-y-0.5 rounded-sm [box-shadow:var(--shadow-bento)]">
      <Link href={`/projects/${project.id}`} className="block">
        <FolderIcon />
        <h3 className="mt-3 truncate text-xl font-semibold tracking-[-0.005em] text-ink-2">
          {project.name}
        </h3>
        {project.description && (
          <p className="mt-1 line-clamp-2 text-sm leading-[1.55] text-mute">
            {project.description}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between text-xs-soft tabular-nums uppercase tracking-[0.18em] text-mute-soft">
          <span>{new Date(project.created_at).toISOString().slice(0, 10)}</span>
          <span>{project.item_count} {t('items')}</span>
        </div>
      </Link>
      {canManage && (
        <Button
          variant="destructive-link"
          size="xs"
          onClick={(e) => {
            e.preventDefault();
            onDelete(project.id);
          }}
          className="!absolute !right-3 !top-3 !hidden !px-0 !py-0 !text-xs-soft !font-normal uppercase tracking-[0.18em] group-hover:!inline-flex"
        >
          {t('delete')}
        </Button>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="36" height="28" viewBox="0 0 36 28" fill="none" aria-hidden>
      <path
        d="M1 4 H13 L16 8 H35 V26 H1 Z"
        stroke="var(--color-amore)"
        strokeWidth="1"
        fill="var(--color-amore-bg)"
      />
    </svg>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft ${className}`}
    >
      {children}
    </th>
  );
}
