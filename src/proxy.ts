import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intl = createIntlMiddleware(routing);

// Common country-code typos for locale prefixes. Without this, someone
// typing `/jp/dashboard` (country code) ends up at `/ko/jp/dashboard`
// (404) because next-intl doesn't recognize `jp`, falls back to the
// negotiated locale, and treats `jp` as part of the path. We catch the
// common ones up front and 308-redirect to the language-code variant
// so /ja, /ko, /en are reachable from intuitive URLs.
const LOCALE_ALIASES: Record<string, string> = {
  jp: 'ja', // Japan country code → Japanese language code
  kr: 'ko', // Korea country code → Korean language code
  us: 'en', // common US English shorthand
  gb: 'en', // UK → English (no separate en-GB locale)
};

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // First segment of the path. `/jp/dashboard` → "jp", `/` → "".
  const firstSeg = pathname.split('/', 2)[1]?.toLowerCase() ?? '';
  const aliased = LOCALE_ALIASES[firstSeg];
  if (aliased) {
    const rest = pathname.slice(firstSeg.length + 1); // includes leading "/" or ""
    const url = request.nextUrl.clone();
    url.pathname = `/${aliased}${rest}`;
    return NextResponse.redirect(url, 308);
  }

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
