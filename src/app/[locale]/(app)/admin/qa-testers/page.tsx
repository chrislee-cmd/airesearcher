import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { QaTesterList, type QaTesterRow } from '@/components/qa/qa-tester-list';

// Super-admin-only page. We gate with getCurrentUser + isSuperAdminEmail +
// notFound() so the route's existence isn't observable to other accounts —
// matching the sibling /admin/* pages (the spec suggested redirect('/'), but
// the canonical admin gate here is notFound(), same as /admin/qa-feedback).
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // The profiles_super_admin_select RLS policy (this PR's migration) lets
  // chris.lee@ read every profile. Without it the base profiles_self_select
  // policy would return only the admin's own row.
  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_qa_tester, created_at')
    .order('created_at', { ascending: false });

  return <QaTesterList profiles={(profiles ?? []) as QaTesterRow[]} />;
}
