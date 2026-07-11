'use client';

/* ────────────────────────────────────────────────────────────────────
   Lightweight periodic RSC refresh — no visible UI.

   Drives an always-on wall/phone monitor: every `intervalMs` it calls
   router.refresh(), which re-runs the server component tree for the
   current route and swaps in fresh data with no full reload, no scroll
   reset, and no user interaction. Purely a data heartbeat — renders
   nothing, so it has no visual/motion effect (prefers-reduced-motion
   irrelevant). Used by the public /status metrics view.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ intervalMs = 60000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
