import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { buildShareAuthorizeUrl } from '@/lib/google-oauth';

// Kicks off Google OAuth with Docs+Sheets scopes for the share feature.
// Accepts ?next=<path> to redirect back to the originating page after auth.
// The return path is base64url-encoded into the state alongside the nonce.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = url.searchParams.get('next') ?? '/dashboard';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const nonce = crypto.randomBytes(16).toString('hex');
  const encodedNext = Buffer.from(nextPath).toString('base64url');
  const state = `${user.id}.${nonce}.${encodedNext}`;
  const authorizeUrl = buildShareAuthorizeUrl(state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('g_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
