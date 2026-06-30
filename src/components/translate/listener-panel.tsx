'use client';

// Listener panel — host-facing list of who is currently listening to the
// live-interpretation share link. Rendered as the right column of the
// 동시통역 fullview. Data comes from Supabase Realtime presence via
// useTranslateListeners; this component is pure presentation.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Listener } from '@/hooks/use-translate-listeners';

type Props = {
  listeners: Listener[];
  className?: string;
};

export function ListenerPanel({ listeners, className }: Props) {
  const t = useTranslations('TranslateConsole.listeners');
  // Tick once a minute so "3분 전" labels advance even when the presence
  // state itself is quiet.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside
      className={`flex flex-col rounded-xs border border-line bg-paper ${className ?? ''}`}
    >
      <header className="border-b border-line px-4 py-3">
        <h3 className="text-md font-bold text-ink">
          {t('title', { count: listeners.length })}
        </h3>
      </header>
      {listeners.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-mute-soft">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {listeners.map((l) => (
            <li key={l.key} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-md text-ink">
                  {shortAnonId(l.anon_id)}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-mute-soft">
                  {relativeJoined(l.joined_at, now, t)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm text-mute">
                {describeAgent(l.user_agent) || t('unknownAgent')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

// First 8 chars of the anon UUID — enough to disambiguate at a glance
// without showing the full opaque id.
function shortAnonId(id: string): string {
  return id.replace(/^anon-/, '').slice(0, 8);
}

function relativeJoined(
  joinedAt: string,
  now: number,
  t: ReturnType<typeof useTranslations>,
): string {
  const ts = Date.parse(joinedAt);
  if (Number.isNaN(ts)) return '';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return t('justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  return t('hoursAgo', { count: hr });
}

// Best-effort "Browser · OS" from a UA string. Coarse on purpose — this
// is a glanceable hint, not analytics.
function describeAgent(ua: string): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' · ');
}
