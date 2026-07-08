import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { getCreditsStatus, spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { checkLlmRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

// 25 files × 25MB matches the legacy `/interviews` ceiling. The /files
// route enforces per-file size again — this is just a fast-fail boundary
// so the user is told "too big" before credits are debited.
const MAX_FILES = 25;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const FileMeta = z.object({
  filename: z.string().min(1).max(500),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  mime: z.string().max(200).optional(),
});

const Body = z.object({
  files: z.array(FileMeta).min(1).max(MAX_FILES),
  locale: z.enum(['ko', 'en']).optional(),
  title: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { files, locale = 'ko', title } = parsed.data;

  const status = await getCreditsStatus(org.org_id);
  const cost = FEATURE_COSTS.insights_analyzer;
  if (!status.isUnlimited && !status.isTrialActive && status.balance < cost) {
    return NextResponse.json(
      { error: 'insufficient_credits', balance: status.balance, required: cost },
      { status: 402 },
    );
  }

  // The jobId doubles as the spend_credits `p_generation_id` — refundCredits
  // (called from /finalize when status=failed) matches on the same uuid,
  // so the two ledger writes line up without a separate `generations` row.
  const jobId = randomUUID();

  const admin = createAdminClient();
  const { error: insertError } = await admin.from('insights_jobs').insert({
    id: jobId,
    org_id: org.org_id,
    user_id: user.id,
    status: 'pending',
    file_count: files.length,
    locale,
    title: title ?? null,
    credits_charged: cost,
  });
  if (insertError) {
    return NextResponse.json(
      { error: 'insert_failed', detail: insertError.message },
      { status: 500 },
    );
  }

  const spend = await spendCredits(org.org_id, 'insights_analyzer', jobId);
  if (!spend.ok) {
    await admin.from('insights_jobs').delete().eq('id', jobId);
    return NextResponse.json(
      { error: spend.reason === 'insufficient' ? 'insufficient_credits' : 'forbidden' },
      { status: spend.reason === 'insufficient' ? 402 : 403 },
    );
  }

  return NextResponse.json({ jobId, status: 'pending' as const });
}
