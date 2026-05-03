import { redirect } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function LocaleIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect({ href: user ? '/dashboard' : '/login', locale });
}
