import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeNotionCode } from '@/lib/share/notion';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const errorParam = url.searchParams.get('error');

  const localeFromCookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('NEXT_LOCALE='))
    ?.slice('NEXT_LOCALE='.length);
  const locale = localeFromCookie === 'en' ? 'en' : 'ko';
  const fallback = (status: string) =>
    new URL(`/${locale}/dashboard?notion=${status}`, url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(fallback('unauth'));
  if (errorParam) return NextResponse.redirect(fallback('denied'));
  if (!code) return NextResponse.redirect(fallback('missing_code'));

  const [stateUserId, nonce, encodedNext] = state.split('.');
  const cookieNonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('notion_oauth_nonce='))
    ?.slice('notion_oauth_nonce='.length);

  if (!stateUserId || !nonce || stateUserId !== user.id || cookieNonce !== nonce) {
    return NextResponse.redirect(fallback('bad_state'));
  }

  let tokens;
  try {
    tokens = await exchangeNotionCode(code);
  } catch {
    return NextResponse.redirect(fallback('token_exchange_failed'));
  }

  const admin = createAdminClient();
  const { error } = await admin.from('user_notion_oauth').upsert({
    user_id: user.id,
    access_token: tokens.access_token,
    workspace_id: tokens.workspace_id,
    workspace_name: tokens.workspace_name,
    bot_id: tokens.bot_id,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.redirect(fallback('store_failed'));

  let destination: URL;
  if (encodedNext) {
    try {
      const nextPath = Buffer.from(encodedNext, 'base64url').toString('utf8');
      destination = new URL(`${nextPath}?notion=connected`, url.origin);
    } catch {
      destination = fallback('connected');
    }
  } else {
    destination = fallback('connected');
  }

  const res = NextResponse.redirect(destination);
  res.cookies.set('notion_oauth_nonce', '', { path: '/', maxAge: 0 });
  return res;
}
