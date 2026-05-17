'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export type CreditsStatus = {
  balance: number;
  trialEndsAt: string | null;
  isUnlimited: boolean;
  isTrialActive: boolean;
};

type Ctx = {
  status: CreditsStatus | null;
  refresh: () => Promise<void>;
  // Wrap any fetch() that may return 402 — on insufficient-credits we open
  // the paywall modal automatically.
  guardedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  showPaywall: () => void;
};

const PaywallCtx = createContext<Ctx | null>(null);

export function PaywallProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<CreditsStatus | null>(null);
  const [open, setOpen] = useState(false);
  const fetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // Use the original (un-intercepted) fetch via direct window reference —
      // safe because /api/credits/status itself never returns 402.
      const res = await fetch('/api/credits/status', { cache: 'no-store' });
      if (!res.ok) return;
      const j = (await res.json()) as CreditsStatus;
      setStatus(j);
    } catch {
      // Silent — the badge just won't render.
    }
  }, []);

  // Fetch once on mount. The badge / paywall both watch the same status.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void refresh();
  }, [refresh]);

  // Global 402 → paywall interceptor. Wrapping window.fetch once means every
  // billable endpoint surfaces the modal automatically — we don't need to
  // sprinkle guardedFetch() through every call site. Idempotent: if multiple
  // mounts happen we still only patch the original fetch once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as Window & { __paywallPatched?: boolean };
    if (w.__paywallPatched) return;
    w.__paywallPatched = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status === 402) {
        setOpen(true);
        void refresh();
      }
      return res;
    };
    return () => {
      window.fetch = original;
      w.__paywallPatched = false;
    };
  }, [refresh]);

  const guardedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      if (res.status === 402) {
        setOpen(true);
        // Also refresh status so the modal shows the latest balance / trial.
        void refresh();
      }
      return res;
    },
    [refresh],
  );

  const showPaywall = useCallback(() => setOpen(true), []);

  const value = useMemo<Ctx>(
    () => ({ status, refresh, guardedFetch, showPaywall }),
    [status, refresh, guardedFetch, showPaywall],
  );

  return (
    <PaywallCtx.Provider value={value}>
      {children}
      {open && <PaywallModal onClose={() => setOpen(false)} status={status} />}
    </PaywallCtx.Provider>
  );
}

export function usePaywall(): Ctx {
  const ctx = useContext(PaywallCtx);
  if (!ctx) throw new Error('usePaywall must be inside PaywallProvider');
  return ctx;
}

function PaywallModal({
  onClose,
  status,
}: {
  onClose: () => void;
  status: CreditsStatus | null;
}) {
  const t = useTranslations('Paywall');

  // Close on Escape; trap focus minimally by autoFocus on the CTA.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] border border-line bg-paper p-7 [border-radius:14px]"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
          {t('eyebrow')}
        </p>
        <h2 className="mt-2 text-[18px] font-bold tracking-[-0.018em] text-ink-2">
          {t('title')}
        </h2>
        <p className="mt-3 text-[12.5px] leading-[1.7] text-mute">
          {t('body', { balance: status?.balance ?? 0 })}
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-line bg-paper px-4 py-1.5 text-[12px] text-ink-2 hover:text-amore [border-radius:14px]"
          >
            {t('later')}
          </button>
          <Link
            href="/credits"
            autoFocus
            onClick={onClose}
            className="border border-ink bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-2 [border-radius:14px]"
          >
            {t('cta')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Compact KST countdown for the trial badge ("23h 14m 남음"). */
export function formatTrialRemaining(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}
