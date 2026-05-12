import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { routing } from '@/i18n/routing';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const explicitNext = url.searchParams.get('next');

  let locale: string = routing.defaultLocale;

  if (code) {
    const supabase = await createClient();
    const { data: session } = await supabase.auth.exchangeCodeForSession(code);

    // Logged-in user: their saved profile.locale wins over Accept-Language.
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('locale')
        .eq('id', session.user.id)
        .maybeSingle();
      const candidate = profile?.locale;
      if (
        candidate &&
        (routing.locales as readonly string[]).includes(candidate)
      ) {
        locale = candidate;
      }
    }
  }

  const target = explicitNext ?? `/${locale}/dashboard`;
  const response = NextResponse.redirect(new URL(target, url.origin));
  // Persist for next-intl middleware so subsequent visits skip
  // Accept-Language detection and respect the user's saved preference.
  response.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return response;
}
