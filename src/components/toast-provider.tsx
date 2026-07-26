'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Optional inline action button (e.g. 보관 직후 "실행취소"). Clicking it runs
// onClick then dismisses the toast. Kept additive so existing toasts (message
// only) are untouched.
type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: string;
  message: string;
  // 'info' is the editorial default — neutral border-line, ink text. 'amore'
  // bumps the accent border for low-priority highlights. 'warn' is reserved
  // for failures we want to keep distinct from the paywall modal.
  tone: 'info' | 'amore' | 'warn';
  ttlMs: number;
  action?: ToastAction;
  // Wave3: 마운트 시 edge slide-in, ttl 만료 시 leaving=true 로 전환해 fade-out
  // 애니메이션(.toast-out)을 재생한 뒤 FADE_MS 후 목록에서 제거.
  leaving: boolean;
};

type Ctx = {
  push: (
    message: string,
    opts?: { tone?: Toast['tone']; ttlMs?: number; action?: ToastAction },
  ) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

// fade-out 길이 — globals.css .toast-out(var(--dur) = 180ms)과 맞춤. reduced-motion
// 이면 CSS 가 즉시 최종 상태라 이 지연만큼만 늦게 사라짐(무해).
const FADE_MS = 180;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  // 스케줄된 타이머를 id 별로 보관 — 재렌더로 중복 스케줄되지 않게.
  const timers = useRef<Map<string, number[]>>(new Map());

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    const handles = timers.current.get(id);
    if (handles) {
      for (const h of handles) window.clearTimeout(h);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<Ctx['push']>((message, opts) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tone = opts?.tone ?? 'info';
    const ttlMs = opts?.ttlMs ?? 3500;
    setItems((prev) => [
      ...prev,
      { id, message, tone, ttlMs, action: opts?.action, leaving: false },
    ]);

    // ttl 만료 → leaving 표시(fade-out 재생) → FADE_MS 후 제거. 두 타이머를
    // id 로 묶어 unmount / 중복 push 시 정리.
    const leaveTimer = window.setTimeout(() => {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      const killTimer = window.setTimeout(() => remove(id), FADE_MS);
      timers.current.set(id, [...(timers.current.get(id) ?? []), killTimer]);
    }, ttlMs);
    timers.current.set(id, [leaveTimer]);
  }, [remove]);

  // unmount 시 모든 타이머 정리.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handles of map.values()) {
        for (const h of handles) window.clearTimeout(h);
      }
      map.clear();
    };
  }, []);

  const value = useMemo<Ctx>(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-toast flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              'pointer-events-auto flex min-w-[260px] max-w-[360px] items-center gap-3 border bg-paper px-4 py-2.5 text-md leading-[1.6] rounded-sm ' +
              (t.leaving ? 'toast-out ' : 'toast-in ') +
              (t.tone === 'amore'
                ? 'border-amore text-ink-2'
                : t.tone === 'warn'
                ? 'border-warning text-warning'
                : 'border-line text-ink-2')
            }
            role="status"
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action ? (
              // eslint-disable-next-line react/forbid-elements -- 토스트 인라인 "실행취소" 텍스트 링크. Button primitive 의 chrome(border/pad/radius)은 토스트 안 인라인 링크와 불일치 — 밑줄 텍스트 어포던스가 맞다.
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  remove(t.id);
                }}
                className="shrink-0 font-semibold text-amore underline-offset-2 hover:underline focus:underline focus:outline-none"
              >
                {t.action.label}
              </button>
            ) : null}
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
