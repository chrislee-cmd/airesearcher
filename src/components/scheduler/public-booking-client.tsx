'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

type Slot = { id: string; date: string; start: string; end: string; status: 'open' | 'booked' };

type Link = {
  id: string;
  slug: string;
  title: string;
  description: string;
  timezone: string;
  expires_at: string | null;
};

type Confirmation = {
  bookingId: string;
  date: string;
  start: string;
  end: string;
  name: string;
  email: string;
};

function groupByDate(slots: Slot[]): { date: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const arr = map.get(s.date) ?? [];
    arr.push(s);
    map.set(s.date, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ss]) => ({
      date,
      slots: ss.slice().sort((a, b) => a.start.localeCompare(b.start)),
    }));
}

function formatDate(iso: string, locale: string): string {
  try {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    });
  } catch {
    return iso;
  }
}

export function PublicBookingClient({ link, initialSlots }: { link: Link; initialSlots: Slot[] }) {
  const t = useTranslations('PublicBooking');
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmation | null>(null);

  // Light polling so a slot taken by someone else disappears (or grays out)
  // without the user reloading. 8s is a reasonable balance for a Calendly-
  // like flow where bookings are minutes apart.
  useEffect(() => {
    if (confirmed) return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/public/scheduler/${link.slug}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { slots: Slot[] };
        setSlots(json.slots);
      } catch {
        /* network blips are fine */
      }
    }, 8000);
    return () => window.clearInterval(id);
  }, [link.slug, confirmed]);

  const grouped = useMemo(() => groupByDate(slots), [slots]);
  const allBooked = slots.length > 0 && slots.every((s) => s.status === 'booked');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/scheduler/${link.slug}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slot_id: picked.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        booking_id?: string;
        slot?: { date: string; start: string; end: string };
        error?: string;
      };
      if (!res.ok) {
        if (json.error === 'slot_unavailable') {
          setError(t('errors.taken'));
          // Refresh availability so user can pick again
          const r2 = await fetch(`/api/public/scheduler/${link.slug}`, { cache: 'no-store' });
          if (r2.ok) {
            const j2 = (await r2.json()) as { slots: Slot[] };
            setSlots(j2.slots);
            setPicked(null);
          }
          return;
        }
        setError(t('errors.generic'));
        return;
      }
      if (json.booking_id && json.slot) {
        setConfirmed({
          bookingId: json.booking_id,
          date: json.slot.date,
          start: json.slot.start,
          end: json.slot.end,
          name: name.trim(),
          email: email.trim(),
        });
      }
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <main className="mx-auto max-w-[640px] px-6 py-16">
        <div className="rounded border border-line bg-paper p-8">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
            {t('confirmed.title')}
          </h1>
          <p className="mt-3 text-[13px] leading-[1.7] text-mute">{t('confirmed.body')}</p>
          <dl className="mt-6 space-y-3 text-[13px]">
            <div className="flex gap-3">
              <dt className="w-20 text-mute">{t('confirmed.when')}</dt>
              <dd className="text-ink">
                {formatDate(confirmed.date, 'ko-KR')} · {confirmed.start}–{confirmed.end}
                <span className="ml-2 text-mute-soft">({link.timezone})</span>
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-20 text-mute">{t('confirmed.name')}</dt>
              <dd className="text-ink">{confirmed.name}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-20 text-mute">{t('confirmed.email')}</dt>
              <dd className="text-ink">{confirmed.email}</dd>
            </div>
          </dl>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[960px] px-6 py-12">
      <header className="border-b border-line pb-4">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
          {link.title || t('fallbackTitle')}
        </h1>
        {link.description ? (
          <p className="mt-2 text-[13px] leading-[1.7] text-mute">{link.description}</p>
        ) : null}
        <p className="mt-2 text-[12px] text-mute-soft">
          {t('timezone')}: {link.timezone}
        </p>
      </header>

      {allBooked ? (
        <p className="mt-10 text-[13px] text-mute">{t('allBooked')}</p>
      ) : slots.length === 0 ? (
        <p className="mt-10 text-[13px] text-mute">{t('noSlots')}</p>
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-[1.2fr_1fr]">
          <section>
            <h2 className="text-[13px] font-semibold text-ink">{t('pickSlot')}</h2>
            <div className="mt-3 space-y-5">
              {grouped.map(({ date, slots: ds }) => (
                <div key={date}>
                  <div className="text-[12px] font-medium text-mute">
                    {formatDate(date, 'ko-KR')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ds.map((s) => {
                      const disabled = s.status === 'booked';
                      const active = picked?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => setPicked(s)}
                          className={[
                            'rounded border px-3 py-1.5 text-[12.5px] transition',
                            disabled
                              ? 'border-line-soft text-mute-soft line-through cursor-not-allowed'
                              : active
                              ? 'border-amore text-amore'
                              : 'border-line text-ink hover:border-ink',
                          ].join(' ')}
                        >
                          {s.start}–{s.end}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-ink">{t('yourInfo')}</h2>
            <form onSubmit={submit} className="mt-3 space-y-3">
              <label className="block">
                <span className="text-[12px] text-mute">{t('name')}</span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-mute">{t('email')}</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-mute">{t('phone')}</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                />
              </label>
              <label className="block">
                <span className="text-[12px] text-mute">{t('note')}</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                />
              </label>
              {picked ? (
                <p className="text-[12px] text-mute">
                  {t('picked')}: {formatDate(picked.date, 'ko-KR')} · {picked.start}–{picked.end}
                </p>
              ) : (
                <p className="text-[12px] text-mute-soft">{t('pickFirst')}</p>
              )}
              {error ? <p className="text-[12px] text-amore">{error}</p> : null}
              <button
                type="submit"
                disabled={!picked || submitting}
                className="w-full rounded border border-ink bg-ink px-3 py-2 text-[13px] font-medium text-paper disabled:opacity-50"
              >
                {submitting ? t('submitting') : t('submit')}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
