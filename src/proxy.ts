import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intl = createIntlMiddleware(routing);

// Cheap cookie-presence check — avoids a Supabase round-trip in middleware.
// Supabase SSR stores the auth token in cookies like `sb-<ref>-auth-token`.
// A user with no such cookie is anonymous; a user with a stale/expired one
// will fall through to `[locale]/page.tsx` which redirects to /login.
function hasAuthCookie(req: NextRequest): boolean {
  return req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
}

// `/`, `/ko`, `/en`, `/ko/`, `/en/`
const LOCALE_ROOT = /^\/(ko|en)?\/?$/;

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Anonymous traffic on the locale root → serve the static landing
  // (public/landing/index.html) under the original URL via rewrite.
  // Pretext canvas + interactive showcase stay intact; URL stays `/`.
  if (LOCALE_ROOT.test(pathname) && !hasAuthCookie(request)) {
    return NextResponse.rewrite(new URL('/landing/index.html', request.url));
  }

  // Routes under /auth (OAuth callback, sign-out, etc.) live outside the
  // `[locale]` segment and must NOT be prefixed. Without this guard
  // next-intl rewrites `/auth/callback?code=…` to `/ko/auth/callback`,
  // which doesn't exist → every production sign-in hits 404.
  if (!pathname.startsWith('/auth/')) {
    const intlResponse = intl(request);
    if (intlResponse.status >= 300 && intlResponse.status < 400) {
      return intlResponse;
    }
  }

  return updateSession(request);
}

export const config = {
  // Skip the Supabase session refresh on internals + API routes.
  // API handlers each call supabase.auth.getUser() themselves and don't
  // need the proxy to mutate cookies — paying for it on every poll
  // (transcripts/jobs, desk/jobs, credits/status, etc.) added a
  // measurable RTT to navigation. /auth/callback stays in the matcher
  // so OAuth redirects still get cookies set.
  matcher: [
    '/((?!api/|_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
