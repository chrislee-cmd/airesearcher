// AI 동시통역 — unlock a finished recording for download.
//
// Charges 25 credits (flat) via `spendCreditsAdminAmount`, then flips the
// recording row to `unlocked`. The deliverable (audio + bilingual
// transcript) is conceptually a transcript export, so the cost matches
// the 전사록 (transcript) generator per PROJECT.md §11 credit scheme.
//
// Idempotent: a second call after a successful unlock returns ok=true
// without re-charging because the credit ledger uses the recording id
// as `generation_id` and the partial UNIQUE on `credit_transactions`
// (migration 0021) refuses a duplicate `feature_use`.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { spendCreditsAdminAmount } from '@/lib/credits';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const TRANSLATE_RECORDING_UNLOCK_CREDITS = 25;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: recordingId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Use admin for the read so the row lookup still works even if RLS
  // races with a transient session refresh. We re-verify host_user_id
  // against `user.id` manually below.
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from('translate_recordings')
    .select('id, org_id, host_user_id, status, storage_key')
    .eq('id', recordingId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (row.status === 'unlocked') {
    return NextResponse.json({ ok: true, already_unlocked: true });
  }
  if (row.status !== 'uploaded') {
    // recording is still mid-flight or failed; nothing to unlock.
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  // Idempotency: `generation_id = recordingId`. Two clicks → one charge.
  const spend = await spendCreditsAdminAmount(
    row.org_id,
    row.host_user_id,
    'translate',
    TRANSLATE_RECORDING_UNLOCK_CREDITS,
    recordingId,
  );
  if (!spend.ok) {
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  const { error: updateErr } = await admin
    .from('translate_recordings')
    .update({
      status: 'unlocked',
      unlocked_at: new Date().toISOString(),
      credits_spent: TRANSLATE_RECORDING_UNLOCK_CREDITS,
    })
    .eq('id', recordingId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    credits_spent: TRANSLATE_RECORDING_UNLOCK_CREDITS,
  });
}
