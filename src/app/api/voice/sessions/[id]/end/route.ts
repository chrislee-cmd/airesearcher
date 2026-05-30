// Voice Concierge — mark a session ended and compute duration.
//
// Idempotent: calling twice keeps the first ended_at / duration_sec.
// We compute duration here (server-authoritative) rather than trusting
// a client clock, because the value gates the daily quota check in
// /api/voice/ephemeral.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const admin = createAdminClient();

  const { data: row, error: readErr } = await admin
    .from('voice_sessions')
    .select('id, org_id, started_at, ended_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Ownership check — voice_sessions has no client-side INSERT/UPDATE
  // policy, so we have to do this in code.
  if (row.org_id !== org.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Idempotent — second call returns the already-stamped values.
  if (row.ended_at) {
    return NextResponse.json({ ok: true, already_ended: true });
  }

  const now = new Date();
  const started = new Date(row.started_at);
  const durationSec = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));

  const { error: updateErr } = await admin
    .from('voice_sessions')
    .update({
      ended_at: now.toISOString(),
      duration_sec: durationSec,
    })
    .eq('id', id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, duration_sec: durationSec });
}
