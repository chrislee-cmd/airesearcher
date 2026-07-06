import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { env } from '@/env';

// Supabase server client for OAuth *redirect* route handlers — currently the
// recruiting Google connect start/callback pair.
//
// The shared createClient() (server.ts) writes rotated session cookies to
// next/headers and relies on the App Router merging them into the outgoing
// response. That merge is reliable for a *same-origin* redirect (the login
// /auth/callback proves it), but the recruiting `start` route redirects
// *cross-origin* to accounts.google.com. If getUser() refreshes an expired
// access token mid-flow (Supabase rotates the refresh_token, single-use) and
// the new cookie never reaches the browser, the browser keeps the now-consumed
// token → the callback's getUser() then fails → the user is bounced to /login
// and the OAuth token is never persisted. (Same class of bug as the awaited
// signOut() cookie-strip in /auth/callback.)
//
// This client instead accumulates every Set-Cookie the SDK emits and hands the
// caller an `applySession(res)` that writes them straight onto the NextResponse
// being returned — the exact pattern updateSession() uses — so a rotated
// session survives even a cross-origin redirect.
export async function createRedirectClient() {
  const cookieStore = await cookies();
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          pending.push(...cookiesToSet);
        },
      },
    },
  );

  // Copy any rotated session cookies onto the response the route returns.
  // No-op when getUser() didn't need to refresh (pending stays empty).
  const applySession = <T extends NextResponse>(res: T): T => {
    for (const c of pending) res.cookies.set(c.name, c.value, c.options);
    return res;
  };

  return { supabase, applySession };
}
