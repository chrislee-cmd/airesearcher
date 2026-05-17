import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  exchangeCodeForTokens,
  decodeIdTokenEmail,
} from '@/lib/google-oauth';

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
  const locale = localeFromCookie === 'en' ? 'en' : 'ko';
  const back = (status: string) =>
    new URL(`/${locale}/recruiting?google=${status}`, url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(back('unauth'));
  }
  if (errorParam) {
    return NextResponse.redirect(back('denied'));
  }
  if (!code) {
    return NextResponse.redirect(back('missing_code'));
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
  if (
    !stateUserId ||
    !nonce ||
    stateUserId !== user.id ||
    cookieNonce !== nonce
  ) {
    return NextResponse.redirect(back('bad_state'));
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch {
    return NextResponse.redirect(back('token_exchange_failed'));
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(back('no_refresh_token'));
  }

  const email = decodeIdTokenEmail(tokens.id_token);
  const admin = createAdminClient();
  const { error } = await admin.from('user_google_oauth').upsert({
    user_id: user.id,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    email,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.redirect(back('store_failed'));
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
  return res;
}
