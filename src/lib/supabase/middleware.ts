import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/env';

// Locale-prefixed first segments that live in the (app) route group and
// therefore require auth. Kept in sync with src/app/[locale]/(app)/*. This
// is Layer 3 (defense-in-depth) — the shared (app)/layout.tsx already gates
// every one of these at render time, so a stale entry here only weakens the
// redundant pre-render gate, it never lets an unauthed page actually render.
const PROTECTED_SEGMENTS = new Set([
  'admin',
  'affinity-bubble',
  'analyzer',
  'canvas',
  'credits',
  'dashboard',
  'design-system',
  'desk',
  'insights-analyzer',
  'interviews',
  'keywords',
  'live',
  'members',
  'moderator',
  'projects',
  'quant',
  'quotes',
  'recruiting',
  'reports',
  'scheduler',
  'settings',
  'slidegen',
  'survey',
  'transcripts',
  'video',
]);

// Mirror of routing.locales — a bare first segment matching one of these is
// a locale prefix, so the protected segment is the *second* path part.
const LOCALES = new Set(['ko', 'en', 'ja', 'th']);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session cookies. This also gives us the auth state for the
  // Layer 3 gate below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layer 3 (pre-render gate): a request for an (app) route with no session
  // is redirected to /login before the RSC layout runs, so the ghost-session
  // app shell never even starts rendering. Public routes (landing, pricing,
  // privacy, ...) are not in PROTECTED_SEGMENTS and pass through untouched.
  if (!user) {
    const segs = request.nextUrl.pathname.split('/').filter(Boolean);
    const [maybeLocale, firstSeg] = segs;
    if (
      LOCALES.has(maybeLocale) &&
      firstSeg &&
      PROTECTED_SEGMENTS.has(firstSeg)
    ) {
      const url = request.nextUrl.clone();
      url.pathname = `/${maybeLocale}/login`;
      url.search = '';
      // Locale-stripped path (e.g. "/canvas") — the shape the login form's
      // safeNext() expects for a post-login bounce-back.
      url.searchParams.set('next', `/${segs.slice(1).join('/')}`);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
