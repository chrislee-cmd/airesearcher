import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { env } from '@/env';
import { updateSession } from '@/lib/supabase/middleware';
import {
  LIMITS,
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '@/lib/rate-limit';

const intl = createIntlMiddleware(routing);

// SEC-003 / SEC-019 — anonymous IP-keyed limits applied at the edge,
// before any handler runs. LLM endpoints add their own user/org-keyed
// check inline (middleware can't intercept a streaming SSE response).
const PUBLIC_RATE_PATHS: Array<{ prefix: string; bucket: 'auth' | 'public' }> = [
  // OAuth callback + trial-init are the only public-ish auth surfaces
  // we currently expose. Brute-force protection lives here.
  { prefix: '/auth/', bucket: 'auth' },
  { prefix: '/api/auth/', bucket: 'auth' },
  // Anonymous viewers: scheduler booking pages + live translation viewer.
  { prefix: '/api/public/', bucket: 'public' },
  { prefix: '/api/translate/public/', bucket: 'public' },
];

async function applyPublicRateLimit(
  request: NextRequest,
  pathname: string,
): Promise<Response | null> {
  const match = PUBLIC_RATE_PATHS.find((p) => pathname.startsWith(p.prefix));
  if (!match) return null;
  const limit =
    match.bucket === 'auth' ? LIMITS.auth : LIMITS.public;
  const result = await rateLimit(
    getClientIp(request),
    `ip:${match.bucket}`,
    limit.limit,
    limit.window,
  );
  if (result.success) return null;
  console.warn('[rate-limit] public blocked', {
    bucket: match.bucket,
    pathname,
    retryAfter: result.retryAfter,
  });
  return rateLimitResponse(result);
}

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

// Optional dedicated subdomain (e.g. `live.research-canvas.io`) that
// serves the public viewer. When a request lands on this host, we
// rewrite `/` and `/<token>` to `/live/<token>` and reject everything
// else as 404 — the marketing app, dashboard, sign-in flow, etc. all
// stay on the main domain. Unset = single-domain mode (path-only).
const VIEWER_HOST = env.NEXT_PUBLIC_TRANSLATE_VIEWER_HOST?.toLowerCase();

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get('host')?.toLowerCase() ?? '';

  // Anonymous IP-keyed limit for auth + public endpoints. Runs before
  // host/locale handling so a 429 short-circuits the rest of the chain.
  const limited = await applyPublicRateLimit(request, pathname);
  if (limited) return limited;

  // Public API paths added to the matcher (auth / public / translate
  // public) only need the rate-limit check above — they don't go through
  // intl rewrites or session refresh.
  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/public/') ||
    pathname.startsWith('/api/translate/public/')
  ) {
    return NextResponse.next();
  }

  // Dedicated viewer subdomain → only the public viewer is reachable.
  if (VIEWER_HOST && host === VIEWER_HOST) {
    if (pathname === '/' || pathname === '') {
      // Bare subdomain visit has no token to load — keep them on /
      // (the viewer layout renders the not-found state).
      return NextResponse.rewrite(new URL('/live/__missing__', request.url));
    }
    // Strip any leading slash and treat the rest as the share token.
    if (!pathname.startsWith('/live/') && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
      const token = pathname.slice(1).split('/', 1)[0];
      const url = request.nextUrl.clone();
      url.pathname = `/live/${token}`;
      return NextResponse.rewrite(url);
    }
    // /live/<token>, /api/translate/public/*, and Next.js asset paths
    // pass through unchanged.
    return NextResponse.next();
  }

  // First segment of the path. `/jp/dashboard` → "jp", `/` → "".
  const firstSeg = pathname.split('/', 2)[1]?.toLowerCase() ?? '';
  const aliased = LOCALE_ALIASES[firstSeg];
  if (aliased) {
    const rest = pathname.slice(firstSeg.length + 1); // includes leading "/" or ""
    const url = request.nextUrl.clone();
    url.pathname = `/${aliased}${rest}`;
    return NextResponse.redirect(url, 308);
  }

  // Routes under /auth (OAuth callback, sign-out, etc.) and /live (the
  // anonymous live-interpretation viewer) live outside the `[locale]`
  // segment and must NOT be prefixed. Without this guard next-intl
  // rewrites `/live/abc` to `/ko/live/abc`, which 404s.
  //
  // `/`, `/ko`, `/en` all flow through this same intl middleware:
  // anonymous root → redirected to the user's preferred locale via
  // Accept-Language + NEXT_LOCALE cookie negotiation. The localized
  // index page (`[locale]/page.tsx`) then renders the marketing
  // landing for anonymous users and forwards authenticated users to
  // /dashboard.
  if (!pathname.startsWith('/auth/') && !pathname.startsWith('/live/')) {
    const intlResponse = intl(request);
    if (intlResponse.status >= 300 && intlResponse.status < 400) {
      return intlResponse;
    }
  }

  return updateSession(request);
}

export const config = {
  // Skip the Supabase session refresh on internals + most API routes.
  // API handlers each call supabase.auth.getUser() themselves and don't
  // need the proxy to mutate cookies — paying for it on every poll
  // (transcripts/jobs, desk/jobs, credits/status, etc.) added a
  // measurable RTT to navigation. /auth/callback stays in the matcher
  // so OAuth redirects still get cookies set.
  //
  // Rate-limited public API paths (`/api/auth/*`, `/api/public/*`,
  // `/api/translate/public/*`) are explicitly added so the proxy can
  // enforce the IP-keyed limit before the handler runs (SEC-003).
  matcher: [
    '/((?!api/|_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/api/auth/:path*',
    '/api/public/:path*',
    '/api/translate/public/:path*',
  ],
};
