import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl, buildShareAuthorizeUrl } from '@/lib/google-oauth';
import { routing } from '@/i18n/routing';

// Kicks off the Google OAuth dance. We sign the state with the user id
// + a random nonce stored in a short-lived cookie; the callback verifies
// the nonce matches before persisting the refresh_token.
//
// `share=1` asks for the superset including Docs + Sheets — needed for
// the recruiting widget's auto-link-sheet path and the Share menu.
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `${user.id}.${nonce}`;
  const wantsShare = requestUrl.searchParams.get('share') === '1';

  // This is a full-page navigation (the wizard does window.location.href
  // = this route), so an uncaught throw here paints Vercel's raw 500 in
  // the browser — exactly what the user hit on a preview env that was
  // missing GOOGLE_CLIENT_ID/SECRET. buildAuthorizeUrl → getGoogleEnv()
  // throws `missing_google_oauth_env` when the OAuth env is incomplete;
  // degrade gracefully by bouncing back into the recruiting flow with a
  // status the widget can strip, instead of a dead-end error page.
  let url: string;
  try {
    url = wantsShare ? buildShareAuthorizeUrl(state) : buildAuthorizeUrl(state);
  } catch {
    const localeFromCookie = request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('NEXT_LOCALE='))
      ?.slice('NEXT_LOCALE='.length);
    const locale =
      localeFromCookie &&
      (routing.locales as readonly string[]).includes(localeFromCookie)
        ? localeFromCookie
        : routing.defaultLocale;
    return NextResponse.redirect(
      new URL(`/${locale}/recruiting?google=config_error`, requestUrl),
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set('g_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
