import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  RecruitingSchedulingClient,
  type SchedBatch,
  type SchedCandidate,
} from '@/components/admin/recruiting-scheduling-client';

// Super-admin-only shell for the recruiting-scheduling stack base (PR1). Same
// gate as /admin/recruiting-invitations — getCurrentUser + isSuperAdminEmail +
// notFound() keeps the route unobservable to other accounts. Reads go through
// the service-role client (RLS super-admin policy also backstops).
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // Touch the RLS-scoped client so an auth refresh happens in the normal path;
  // the actual reads use the service-role admin client (mirrors invitations).
  await createClient();
  const admin = createAdminClient();

  const { data: batchRows } = await admin
    .from('sched_batches')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  const batches: SchedBatch[] = batchRows ?? [];

  const { batch } = await searchParams;
  const selectedBatchId =
    batch && batches.some((b) => b.id === batch)
      ? batch
      : (batches[0]?.id ?? null);

  let candidates: SchedCandidate[] = [];
  if (selectedBatchId) {
    // participant_token intentionally NOT selected — not exposed in PR1.
    const { data: candRows } = await admin
      .from('sched_candidates')
      .select('id, email, name, phone, fields')
      .eq('batch_id', selectedBatchId)
      .order('created_at', { ascending: true })
      .limit(2000);
    candidates = (candRows ?? []) as SchedCandidate[];
  }

  return (
    <RecruitingSchedulingClient
      batches={batches}
      selectedBatchId={selectedBatchId}
      candidates={candidates}
    />
  );
}
