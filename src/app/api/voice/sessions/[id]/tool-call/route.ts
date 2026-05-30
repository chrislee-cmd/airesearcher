// Voice Concierge — atomic increment of voice_sessions.tool_calls.
//
// Lightweight analytics hook fired (best-effort) by the client right
// after the SDK auto-feeds a tool's execute() return value back to the
// model. Server-side increment via service-role; the client doesn't
// have UPDATE permission on voice_sessions (no INSERT/UPDATE RLS — see
// migration 0023 forgery defense).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
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

  // Ownership check — same pattern as /end and /message routes.
  const { data: session, error: readErr } = await admin
    .from('voice_sessions')
    .select('id, org_id, tool_calls')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.org_id !== org.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Read-modify-write rather than an RPC because there's no atomic
  // increment helper in this repo yet. Race-prone in theory; in practice
  // tool calls within a single voice session arrive sequentially because
  // the model waits for each tool result before calling the next, so
  // there's no concurrent writer on this row.
  const next = (session.tool_calls ?? 0) + 1;
  const { error: updateErr } = await admin
    .from('voice_sessions')
    .update({ tool_calls: next })
    .eq('id', id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, tool_calls: next });
}
