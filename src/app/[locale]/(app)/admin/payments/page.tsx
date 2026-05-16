import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { createAdminClient } from '@/lib/supabase/admin';
import { AdminPayments } from '@/components/admin-payments';

// Super-admin-only. Renders notFound() for all other accounts so the
// route's existence is not observable.
export default async function AdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  const admin = createAdminClient();
  const { data } = await admin
    .from('payments')
    .select(`
      id,
      org_id,
      bundle_id,
      credits,
      amount_krw,
      status,
      bank_reference,
      tax_invoice,
      created_at,
      paid_at,
      organizations ( name )
    `)
    .eq('method', 'bank_transfer')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-[1200px] px-2 pb-16 pt-6">
      <div className="border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            ADMIN
          </span>
        </div>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.02em] text-ink">
          무통장 결제 관리
        </h1>
        <p className="mt-1 text-[12px] text-mute">
          입금 확인 후 &quot;입금 확인&quot; 버튼을 누르면 해당 조직에 크레딧이 즉시 지급됩니다.
        </p>
      </div>

      <div className="mt-6">
        <AdminPayments initialPayments={(data ?? []).map((p) => ({
          ...p,
          organizations: Array.isArray(p.organizations) ? (p.organizations[0] ?? null) : p.organizations,
        })) as Parameters<typeof AdminPayments>[0]['initialPayments']}
      />
      </div>
    </div>
  );
}
