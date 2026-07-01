import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminUsageReport } from '@/lib/admin/providers';
import { getLatestSnapshot } from '@/lib/admin/snapshots';
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

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  const [report, baseline] = await Promise.all([
    getAdminUsageReport(),
    // baseline is non-critical UI — if the snapshots table isn't there yet
    // (migration not applied on this env) or the query fails, degrade to
    // the "no baseline" state instead of 500-ing the whole dashboard.
    getLatestSnapshot().catch(() => null),
  ]);
  return <AdminApiUsage report={report} baseline={baseline} />;
}
