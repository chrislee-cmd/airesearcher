import { type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intl = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Routes under /auth (OAuth callback, sign-out, etc.) live outside the
  // `[locale]` segment and must NOT be prefixed. Without this guard
  // next-intl rewrites `/auth/callback?code=…` to `/ko/auth/callback`,
  // which doesn't exist → every production sign-in hits 404.
  //
  // `/`, `/ko`, `/en` all flow through this same intl middleware:
  // anonymous root → redirected to the user's preferred locale via
  // Accept-Language + NEXT_LOCALE cookie negotiation. The localized
  // index page (`[locale]/page.tsx`) then renders the marketing
  // landing for anonymous users and forwards authenticated users to
  // /dashboard.
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
