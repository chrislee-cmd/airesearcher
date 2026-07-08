import { NextResponse } from 'next/server';
import { createRedirectClient } from '@/lib/supabase/route-client';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  exchangeCodeForTokens,
  decodeIdTokenEmail,
} from '@/lib/google-oauth';
import { encryptToken } from '@/lib/crypto/token-cipher';
import { routing } from '@/i18n/routing';

// Receives the OAuth code, swaps it for tokens, and stores the
// long-lived refresh_token under the current user's row. Then redirects
// back into the recruiting page with a status query so the UI can show
// "Google 연결됨" without a manual refresh.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const errorParam = url.searchParams.get('error');

  // next-intl uses `localePrefix: 'always'` so every page route lives
  // under /<locale>/. The user's preferred locale is in NEXT_LOCALE; fall
  // back to the project default 'ko' if the cookie is missing.
  const localeFromCookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('NEXT_LOCALE='))
    ?.slice('NEXT_LOCALE='.length);
  // Preserve the user's locale if it's one we ship; otherwise fall back
  // to the routing default. Reading from routing.locales avoids drift
  // when a new locale is added.
  const locale =
    localeFromCookie &&
    (routing.locales as readonly string[]).includes(localeFromCookie)
      ? localeFromCookie
      : routing.defaultLocale;
  const back = (status: string) =>
    new URL(`/${locale}/recruiting?google=${status}`, url);

  // Redirect client so a rotated session cookie survives back to the browser
  // (see route-client.ts). applySession() is applied to every response below.
  const { supabase, applySession } = await createRedirectClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (errorParam) {
    return applySession(NextResponse.redirect(back('denied')));
  }
  if (!code) {
    return applySession(NextResponse.redirect(back('missing_code')));
  }

  // state format: `${userId}.${nonce}` (recruiting) or
  // `${userId}.${nonce}.${base64url(nextPath)}` (share feature)
  const stateParts = state.split('.');
  const [stateUserId, nonce, encodedNext] = stateParts;
  const cookieNonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('g_oauth_nonce='))
    ?.slice('g_oauth_nonce='.length);

  // The httpOnly nonce (set by /start, which required a valid session) is the
  // CSRF binding for this flow. When it matches the state, the state's user id
  // is authentic — even if the app session cookie briefly dropped during the
  // Google round-trip. We prefer the live session id but fall back to the
  // state id so the refresh_token still gets persisted: the user may need to
  // re-login, but the (admin) token lands in the DB and the server self-heals
  // on the next request. Without a valid nonce we can't trust the flow at all.
  const nonceValid =
    !!stateUserId && !!nonce && !!cookieNonce && cookieNonce === nonce;

  // With a live session, the state must still match it (unchanged CSRF guard).
  if (user && (!nonceValid || stateUserId !== user.id)) {
    return applySession(NextResponse.redirect(back('bad_state')));
  }
  const effectiveUserId = user?.id ?? (nonceValid ? stateUserId : null);
  if (!effectiveUserId) {
    return applySession(NextResponse.redirect(back('unauth')));
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch {
    return applySession(NextResponse.redirect(back('token_exchange_failed')));
  }

  if (!tokens.refresh_token) {
    return applySession(NextResponse.redirect(back('no_refresh_token')));
  }

  const email = decodeIdTokenEmail(tokens.id_token);
  const admin = createAdminClient();
  const { error } = await admin.from('user_google_oauth').upsert({
    user_id: effectiveUserId,
    // Encrypt at rest — the browser can no longer read this row (self-select
    // policy dropped) and now a DB/backup leak can't recover the token either.
    refresh_token: encryptToken(tokens.refresh_token),
    scope: tokens.scope,
    email,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return applySession(NextResponse.redirect(back('store_failed')));
  }

  // If the share feature encoded a return path in state, redirect there.
  let destination: URL;
  if (encodedNext) {
    try {
      const nextPath = Buffer.from(encodedNext, 'base64url').toString('utf8');
      destination = new URL(`${nextPath}?google=connected`, url.origin);
    } catch {
      destination = back('connected');
    }
  } else {
    destination = back('connected');
  }

  const res = NextResponse.redirect(destination);
  // Clear the nonce cookie now that we've consumed it.
  res.cookies.set('g_oauth_nonce', '', { path: '/', maxAge: 0 });
  return applySession(res);
}
