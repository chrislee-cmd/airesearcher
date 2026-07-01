'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Mounted inside the (app) route group only. When the session ends while
 * the user is on an authenticated page — manual sign-out, session expiry,
 * or a sign-out in another tab — this redirects to /login instead of
 * leaving the now-dead app view rendered. That "ghost session" state (the
 * canvas stayed up, only the top-right button flipped to "sign in", and
 * every subsequent action 401'd) is the bug this fixes.
 *
 * Scoping the listener to the (app) layout is deliberate: public pages
 * (landing, pricing, privacy, ...) never mount it, so a sign-out there
 * leaves the user where they are. AuthProvider (mounted app-wide in
 * [locale]/layout) keeps its own onAuthStateChange for the login dialog —
 * a second, redirect-only subscription here is independent and cheap.
 */
export function AuthStateListener() {
  const router = useRouter();
  const pathname = usePathname();

  // Keep the current path in a ref so the subscription stays stable across
  // navigations (no unsubscribe/resubscribe churn on every route change)
  // while still redirecting back to wherever the user actually was.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT: explicit sign-out or a revoked/other-device session.
      // TOKEN_REFRESHED with no session: the refresh failed (expired).
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        // usePathname() from next-intl navigation is locale-stripped
        // (e.g. "/canvas"), which is exactly the shape the login form's
        // safeNext() expects for `?next=`.
        const path = pathnameRef.current;
        const query = path && path !== '/' ? `?next=${encodeURIComponent(path)}` : '';
        router.replace(`/login${query}`);
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
