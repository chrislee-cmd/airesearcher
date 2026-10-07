import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminUsageReport } from '@/lib/admin/providers';
import { getLatestSnapshot } from '@/lib/admin/snapshots';
import { getToplineMeteringReport } from '@/lib/admin/topline-metering';
import { AdminApiUsage } from '@/components/admin-api-usage';
import { AdminToplineMetering } from '@/components/admin-topline-metering';

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

  const [report, baseline, meteringReport] = await Promise.all([
    getAdminUsageReport(),
    // baseline is non-critical UI — if the snapshots table isn't there yet
    // (migration not applied on this env) or the query fails, degrade to
    // the "no baseline" state instead of 500-ing the whole dashboard.
    getLatestSnapshot().catch(() => null),
    // 탑라인 실측 미터링 — usage 컬럼 마이그 미적용 환경에서도 대시보드를 깨지
    // 않게 degrade(모듈 자체도 쿼리 실패 시 빈 리포트를 반환하지만 이중 방어).
    getToplineMeteringReport().catch(() => null),
  ]);
  return (
    <>
      <AdminApiUsage report={report} baseline={baseline} />
      {meteringReport && <AdminToplineMetering report={meteringReport} />}
    </>
  );
}
