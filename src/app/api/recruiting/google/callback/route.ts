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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/recruiting?google=unauth', url));
  }
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/recruiting?google=denied`, url),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL('/recruiting?google=missing_code', url));
  }

  const [stateUserId, nonce] = state.split('.');
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
    return NextResponse.redirect(new URL('/recruiting?google=bad_state', url));
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch {
    return NextResponse.redirect(
      new URL('/recruiting?google=token_exchange_failed', url),
    );
  }

  if (!tokens.refresh_token) {
    return NextResponse.redirect(
      new URL('/recruiting?google=no_refresh_token', url),
    );
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
    return NextResponse.redirect(
      new URL('/recruiting?google=store_failed', url),
    );
  }

  const res = NextResponse.redirect(new URL('/recruiting?google=connected', url));
  // Clear the nonce cookie now that we've consumed it.
  res.cookies.set('g_oauth_nonce', '', { path: '/', maxAge: 0 });
  return res;
}
