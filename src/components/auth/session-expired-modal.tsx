'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
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

/**
 * Global session-expiry prompt. Mounted once inside the (app) layout, it
 * subscribes to the module-level expiry latch that `fetchWithAuth` trips on
 * the first HTTP 401. When tripped it shows an explicit, non-dismissible
 * modal and — whether the user clicks "sign in" or ignores it for 3s —
 * sends them to /login with a `?next=` back to where they were.
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

  // Auto-redirect after a grace period once the modal is open.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(redirectToLogin, AUTO_REDIRECT_MS);
    return () => clearTimeout(handle);
  }, [open, redirectToLogin]);

  return (
    <Modal
      open={open}
      // No X / backdrop dismissal — this is a forced redirect. Esc (the
      // primitive's only other close path) also routes to /login.
      onClose={redirectToLogin}
      dismissOnBackdrop={false}
      size="sm"
      title={t('sessionExpiredTitle')}
      description={t('sessionExpiredBody')}
      footer={
        <Button variant="primary" size="md" onClick={redirectToLogin}>
          {t('sessionExpiredCta')}
        </Button>
      }
    >
      {null}
    </Modal>
  );
}
