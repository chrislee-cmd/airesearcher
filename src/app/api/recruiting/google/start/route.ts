import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl, buildShareAuthorizeUrl } from '@/lib/google-oauth';

// Kicks off the Google OAuth dance. We sign the state with the user id
// + a random nonce stored in a short-lived cookie; the callback verifies
// the nonce matches before persisting the refresh_token.
//
// `share=1` asks for the superset including Docs + Sheets — needed for
// the recruiting widget's auto-link-sheet path and the Share menu.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `${user.id}.${nonce}`;
  const wantsShare = new URL(request.url).searchParams.get('share') === '1';
  const url = wantsShare ? buildShareAuthorizeUrl(state) : buildAuthorizeUrl(state);

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
