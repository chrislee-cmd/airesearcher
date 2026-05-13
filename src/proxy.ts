import type { NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

// next-intl middleware: auto-detects locale from Accept-Language header
// + NEXT_LOCALE cookie. If the URL has no locale prefix, it redirects to
// `/{detectedLocale}/...`. If already prefixed, it passes through and we
// continue to Supabase session refresh.
const intl = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  // Routes under /auth (OAuth callback, sign-out, etc.) live outside the
  // `[locale]` segment and must NOT be prefixed. Without this guard
  // next-intl rewrites `/auth/callback?code=…` to `/ko/auth/callback`,
  // which doesn't exist → every production sign-in hits 404.
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/auth/')) {
    const intlResponse = intl(request);
    // intl returns a redirect when the URL is missing a locale prefix.
    // Honor it immediately — Supabase will refresh on the next request.
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
