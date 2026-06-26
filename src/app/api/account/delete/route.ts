// PR-SEC5 — GDPR Art. 17 erasure endpoint.
//
// Hard-deletes the calling user via the Supabase Admin API. The DB-side
// retrofit in 20260626140000_account_delete_retention.sql adds the FK
// cascades that make this safe: pure-PII rows (generations, transcripts,
// voice/translate sessions, owned organizations) cascade-delete, while
// payments / credit_transactions / audit_log keep the row and null out
// the user_id so financial and forensic history survives erasure.
//
// audit_log is written *before* deleteUser so the row exists even if the
// admin call partially fails — and the snapshot of email / IP / UA on
// audit_log is denormalized (SEC7) so the trail still reads cleanly after
// the user row is gone.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Snapshot before delete — once the auth.users row is gone, getUser
  // can't recover the email for the audit row.
  const userId = user.id;
  const userEmail = user.email ?? null;

  // Two-phase audit (PR-SEC12): _requested before the destructive call,
  // _completed after success. If deleteUser fails the _requested row
  // alone tells the forensic story; _completed only ever appears on a
  // confirmed delete. logAudit never throws so a write failure here
  // won't strand the delete.
  await logAudit({
    event_type: 'account_deletion_requested',
    user_id: userId,
    actor_email: userEmail,
    resource_type: 'user',
    resource_id: userId,
    request,
  });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  await logAudit({
    event_type: 'account_deletion_completed',
    // user_id intentionally null — the auth.users row no longer exists
    // and the FK is `on delete set null`. actor_email keeps the trail.
    user_id: null,
    actor_email: userEmail,
    resource_type: 'user',
    resource_id: userId,
    request,
  });

  // Sign the session out server-side too — the auth.users row is gone
  // but the browser still holds sb-* cookies until they expire. Best
  // effort; the client-side flow also calls signOut before redirecting.
  await supabase.auth.signOut().catch(() => {});

  return new NextResponse(null, { status: 204 });
}
