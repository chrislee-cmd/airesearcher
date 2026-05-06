import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizeUrl } from '@/lib/google-oauth';

// Kicks off the Google OAuth dance. We sign the state with the user id
// + a random nonce stored in a short-lived cookie; the callback verifies
// the nonce matches before persisting the refresh_token.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `${user.id}.${nonce}`;
  const url = buildAuthorizeUrl(state);

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
