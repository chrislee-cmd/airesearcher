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
import type { SchedSlot } from '@/lib/scheduling/slots';

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
  let slots: SchedSlot[] = [];
  if (selectedBatchId) {
    // participant_token now surfaced (PR4) so the list can render each
    // candidate's public share link.
    const { data: candRows } = await admin
      .from('sched_candidates')
      .select('id, email, name, phone, fields, participant_token')
      .eq('batch_id', selectedBatchId)
      .order('created_at', { ascending: true })
      .limit(2000);
    candidates = (candRows ?? []) as SchedCandidate[];

    // Slots for this batch = slots whose candidate_id is in the batch. Fetched
    // as a 2-step .in() query rather than a PostgREST embed — sched_slots and
    // sched_batches have no direct FK, and a transitive embed would silently
    // return 0 rows (PROJECT.md §7.10).
    const candidateIds = candidates.map((c) => c.id);
    if (candidateIds.length > 0) {
      const { data: slotRows } = await admin
        .from('sched_slots')
        .select('id, candidate_id, start_at, end_at, status, location, note')
        .in('candidate_id', candidateIds)
        .order('start_at', { ascending: true })
        .limit(5000);
      slots = (slotRows ?? []) as SchedSlot[];
    }
  }

  return (
    <RecruitingSchedulingClient
      batches={batches}
      selectedBatchId={selectedBatchId}
      candidates={candidates}
      slots={slots}
    />
  );
}
