import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminUsageReport } from '@/lib/admin/providers';
import { AdminApiUsage } from '@/components/admin-api-usage';

// Super-admin-only page. We render with `notFound()` for non-admins so
// the route's existence isn't observable to other accounts.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  const report = await getAdminUsageReport();
  return <AdminApiUsage report={report} />;
}
