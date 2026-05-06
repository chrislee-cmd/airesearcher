'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Toast = {
  id: string;
  message: string;
  // 'info' is the editorial default — neutral border-line, ink text. 'amore'
  // bumps the accent border for low-priority highlights. 'warn' is reserved
  // for failures we want to keep distinct from the paywall modal.
  tone: 'info' | 'amore' | 'warn';
  ttlMs: number;
};

type Ctx = {
  push: (message: string, opts?: { tone?: Toast['tone']; ttlMs?: number }) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback<Ctx['push']>((message, opts) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tone = opts?.tone ?? 'info';
    const ttlMs = opts?.ttlMs ?? 3500;
    setItems((prev) => [...prev, { id, message, tone, ttlMs }]);
  }, []);

  // Auto-dismiss. Each toast has its own timer keyed by id; cleared on
  // unmount or when the toast is removed by another path.
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((t) =>
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, t.ttlMs),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
    // We deliberately re-run when the list grows; clearing on every change
    // would defeat the per-toast timer. Stable identity is enforced by the
    // `id` field so React doesn't re-trigger for unchanged items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const value = useMemo<Ctx>(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[90] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto min-w-[260px] max-w-[360px] border bg-paper px-4 py-2.5 text-[12px] leading-[1.6] [border-radius:4px] ' +
              (t.tone === 'amore'
                ? 'border-amore text-ink-2'
                : t.tone === 'warn'
                ? 'border-warning text-warning'
                : 'border-line text-ink-2')
            }
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}
