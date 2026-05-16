'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Requirement } from '@/lib/scheduler/types';
import { expandRequirementSlots } from '@/lib/scheduler/slots';

type BookingLink = {
  id: string;
  slug: string;
  title: string;
  description: string;
  timezone: string;
  status: 'active' | 'closed';
  expires_at: string | null;
  created_at: string;
  project_id: string | null;
  slots: { id: string; date: string; start_time: string; end_time: string; status: string }[];
  bookings: { id: string; slot_id: string; name: string; email: string; created_at: string }[];
};

export type ProjectOption = { id: string; name: string };

export type LinkBooking = {
  id: string;
  name: string;
  email: string;
  date: string;
  start: string;
  end: string;
  projectId: string | null;
};

type Props = {
  requirement: Requirement;
  projectId: string | null;
  projects: ProjectOption[];
  visibleProjectIds: Set<string | 'none'>;
  colorFor: (projectId: string | null) => { bg: string; border: string; hex: string };
  onBookingsChange?: (bookings: LinkBooking[]) => void;
};

function publicUrl(slug: string): string {
  if (typeof window === 'undefined') return `/book/${slug}`;
  const path = window.location.pathname;
  // pathname starts with /<locale>/...; reuse the locale prefix
  const seg = path.split('/').filter(Boolean);
  const locale = seg[0] && seg[0].length === 2 ? seg[0] : 'ko';
  return `${window.location.origin}/${locale}/book/${slug}`;
}

export function BookingLinksPanel({
  requirement,
  projectId,
  projects,
  visibleProjectIds,
  colorFor,
  onBookingsChange,
}: Props) {
  const t = useTranslations('Scheduler.booking');
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [linkProjectId, setLinkProjectId] = useState<string | null>(projectId);
  useEffect(() => {
    setLinkProjectId(projectId);
  }, [projectId]);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const projectName = useCallback(
    (id: string | null) => {
      if (!id) return t('noProject');
      return projects.find((p) => p.id === id)?.name ?? t('unknownProject');
    },
    [projects, t],
  );

  const slotPreviewCount = useMemo(
    () => expandRequirementSlots(requirement).length,
    [requirement],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/scheduler/links', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { links: BookingLink[] };
      const next = json.links ?? [];
      setLinks(next);
      if (onBookingsChange) {
        const flat: LinkBooking[] = [];
        for (const l of next) {
          for (const b of l.bookings) {
            const slot = l.slots.find((s) => s.id === b.slot_id);
            if (!slot) continue;
            flat.push({
              id: b.id,
              name: b.name,
              email: b.email,
              date: slot.date,
              start: String(slot.start_time).slice(0, 5),
              end: String(slot.end_time).slice(0, 5),
              projectId: l.project_id,
            });
          }
        }
        onBookingsChange(flat);
      }
    } finally {
      setLoading(false);
    }
  }, [onBookingsChange]);

  useEffect(() => {
    void refresh();
    // Poll every 15s so a new public booking shows up in the in-app
    // canvas within the same minute without a page reload.
    const id = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function create() {
    if (slotPreviewCount === 0) {
      setError(t('errors.noSlots'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/scheduler/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requirement,
          title: title.trim(),
          description: description.trim(),
          timezone: requirement.timezone || 'Asia/Seoul',
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          project_id: linkProjectId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; slug?: string };
      if (!res.ok) {
        setError(json.error || t('errors.createFailed'));
        return;
      }
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setExpiresAt('');
      await refresh();
    } catch {
      setError(t('errors.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: 'active' | 'closed') {
    await fetch(`/api/scheduler/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

  async function remove(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    await fetch(`/api/scheduler/links/${id}`, { method: 'DELETE' });
    await refresh();
  }

  async function copy(slug: string, id: string) {
    const url = publicUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      window.prompt(t('copyManual'), url);
    }
  }

  return (
    <section className="rounded border border-line bg-paper p-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">{t('title')}</h2>
          <p className="mt-1 text-[12px] text-mute">{t('description')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded border border-ink bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
        >
          {showCreate ? t('cancel') : t('newLink')}
        </button>
      </header>

      {showCreate ? (
        <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
          <p className="text-[12px] text-mute">
            {t('slotsPreview', { count: slotPreviewCount })}
          </p>
          <label className="block">
            <span className="text-[12px] text-mute">{t('linkProject')}</span>
            <select
              value={linkProjectId ?? ''}
              onChange={(e) => setLinkProjectId(e.target.value || null)}
              className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
            >
              <option value="">{t('noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] text-mute">{t('linkTitle')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('linkTitlePlaceholder')}
              className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-mute">{t('linkDescription')}</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-mute">{t('expires')}</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
            />
          </label>
          {error ? <p className="text-[12px] text-amore">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border border-line px-3 py-1.5 text-[12px] text-ink"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={creating || slotPreviewCount === 0}
              onClick={create}
              className="rounded border border-ink bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50"
            >
              {creating ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {loading && links.length === 0 ? (
          <li className="text-[12px] text-mute">{t('loading')}</li>
        ) : links.length === 0 ? (
          <li className="text-[12px] text-mute">{t('empty')}</li>
        ) : (
          links
            .filter((l) => visibleProjectIds.has(l.project_id ?? 'none'))
            .map((l) => {
            const total = l.slots.length;
            const booked = l.slots.filter((s) => s.status === 'booked').length;
            const url = publicUrl(l.slug);
            return (
              <li key={l.id} className="rounded border border-line-soft p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">
                        {l.title || t('untitled')}
                      </span>
                      <span
                        className={[
                          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-ink',
                          colorFor(l.project_id).border,
                        ].join(' ')}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: colorFor(l.project_id).hex }}
                        />
                        {projectName(l.project_id)}
                      </span>
                      <span
                        className={[
                          'rounded border px-1.5 py-0.5 text-[10px]',
                          l.status === 'active'
                            ? 'border-line text-mute'
                            : 'border-line-soft text-mute-soft',
                        ].join(' ')}
                      >
                        {l.status === 'active' ? t('statusActive') : t('statusClosed')}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-mute">{url}</p>
                    <p className="mt-1 text-[12px] text-mute-soft">
                      {t('progress', { booked, total })} · {l.timezone}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => copy(l.slug, l.id)}
                      className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:border-ink"
                    >
                      {copiedId === l.id ? t('copied') : t('copy')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(l.id, l.status === 'active' ? 'closed' : 'active')}
                      className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:border-ink"
                    >
                      {l.status === 'active' ? t('close') : t('reopen')}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(l.id)}
                      className="rounded border border-line-soft px-2 py-1 text-[11px] text-mute hover:text-amore"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
                {l.bookings.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-t border-line-soft pt-2 text-[12px]">
                    {l.bookings.map((b) => {
                      const slot = l.slots.find((s) => s.id === b.slot_id);
                      return (
                        <li key={b.id} className="flex justify-between gap-3">
                          <span className="text-ink">
                            {b.name} <span className="text-mute-soft">({b.email})</span>
                          </span>
                          {slot ? (
                            <span className="text-mute">
                              {slot.date} {String(slot.start_time).slice(0, 5)}–
                              {String(slot.end_time).slice(0, 5)}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
