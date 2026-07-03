'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  isSessionExpired,
  subscribeSessionExpired,
} from '@/lib/api/session-expired';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

// Seconds of inaction before we redirect the user to /login on their
// behalf (spec: "3초 자동 redirect (사용자 무반응 시)").
const AUTO_REDIRECT_MS = 3000;
// Progress-bar tick cadence — smooth enough to read as an animation
// without churning React state every frame.
const TICK_MS = 50;

/**
 * Global session-expiry prompt. Mounted once inside the (app) layout, it
 * subscribes to the module-level expiry latch that `fetchWithAuth` trips on
 * the first HTTP 401. When tripped it shows an explicit, non-dismissible
 * modal and — whether the user clicks "sign in" or ignores it for 3s —
 * sends them to /login with a `?next=` back to where they were.
 *
 * The redesign (2026-07-04) surfaces the otherwise-invisible auto-redirect:
 * a large 🔒 glyph, centered copy, and an amore progress bar that drains
 * 100% → 0% over the grace period with a live "N초 후 자동 이동..." caption,
 * capped by a full-width primary CTA.
 *
 * Complements <AuthStateListener /> (PR #597), which only catches the
 * *explicit* SIGNED_OUT / failed-refresh events. Silent server-side
 * expiry produces no auth event, only 401s — this is that path's UX.
 */
export function SessionExpiredModal() {
  const t = useTranslations('Auth');
  const router = useRouter();
  const pathname = usePathname();

  // Read the latch through useSyncExternalStore so the modal opens the
  // instant any fetch marks the session expired, without a provider.
  const open = useSyncExternalStore(
    subscribeSessionExpired,
    isSessionExpired,
    // Server snapshot: never expired during SSR.
    () => false,
  );

  // Keep the live path in a ref so the redirect always targets wherever the
  // user actually is, without re-arming the timer effect on every nav.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Guard against a double redirect (CTA click racing the auto-timer).
  const redirectedRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    // usePathname() from next-intl navigation is locale-stripped
    // (e.g. "/canvas") — exactly the shape the login form's safeNext()
    // expects for `?next=`. useRouter() here re-adds the active locale.
    const path = pathnameRef.current;
    const query =
      path && path !== '/' ? `?next=${encodeURIComponent(path)}` : '';
    router.replace(`/login${query}`);
    router.refresh();
  }, [router]);

  // Countdown progress (100 → 0) driving both the bar width and the caption.
  // Starts full (useState) and is drained by the tick loop while open; a
  // fired redirect unmounts this whole tree, so there's no stale-value
  // reopen to guard against and no synchronous in-effect reset needed.
  const [progress, setProgress] = useState(100);
  useEffect(() => {
    if (!open) return;
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_REDIRECT_MS) * 100);
      setProgress(remaining);
      if (remaining === 0) clearInterval(tick);
    }, TICK_MS);
    const handle = setTimeout(redirectToLogin, AUTO_REDIRECT_MS);
    return () => {
      clearTimeout(handle);
      clearInterval(tick);
    };
  }, [open, redirectToLogin]);

  const secondsRemaining = Math.ceil(
    (progress / 100) * (AUTO_REDIRECT_MS / 1000),
  );

  return (
    <Modal
      open={open}
      // No X / backdrop dismissal — this is a forced redirect. Esc (the
      // primitive's only other close path) also routes to /login.
      onClose={redirectToLogin}
      dismissOnBackdrop={false}
      size="sm"
      // Header/footer are rendered inline below so the whole prompt reads as
      // one centered editorial column (icon → title → body → countdown → CTA)
      // instead of the primitive's left-aligned header + footer bar.
      labelledBy="session-expired-title"
    >
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="text-5xl leading-none" aria-hidden>
          🔒
        </div>
        <h2
          id="session-expired-title"
          className="text-lg font-semibold text-ink"
        >
          {t('sessionExpiredTitle')}
        </h2>
        <p className="text-sm text-mute">{t('sessionExpiredBody')}</p>
        <div className="mt-2 w-full space-y-2">
          <div className="h-1 w-full overflow-hidden rounded-xs bg-line-soft">
            <div
              className="h-full bg-amore transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
              aria-hidden
            />
          </div>
          <p className="text-xs text-mute-soft" aria-live="polite">
            {t('sessionExpiredCountdown', { seconds: secondsRemaining })}
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={redirectToLogin}
          fullWidth
          className="mt-2"
          rightIcon={<span aria-hidden>→</span>}
        >
          {t('sessionExpiredCta')}
        </Button>
      </div>
    </Modal>
  );
}
