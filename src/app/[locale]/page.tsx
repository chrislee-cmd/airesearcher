import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/supabase/user';

// Anonymous traffic is rewritten by `proxy.ts` to /landing/index.html
// before reaching this page, so this component only runs for users who
// already have a Supabase auth cookie. We still re-check the user here
// to cover the rare "stale cookie, expired session" path — sending them
// to login is safer than letting `(app)/layout.tsx` render in a half-
// auth state.
export default async function LocaleIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  redirect({ href: user ? '/dashboard' : '/login', locale });
}
