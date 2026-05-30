// Voice Concierge — append a transcript line to voice_messages.
//
// The client streams finalized transcript chunks from the RealtimeSession
// here so a refresh / new session can later replay the conversation.
// Direct client INSERTs are blocked by RLS (no INSERT policy in migration
// 0023) — this route is the only path, and writes go through the
// service-role admin client.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

const Body = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  // Cap at 8KB per row — long enough for any reasonable single utterance,
  // short enough that an abusive client can't bloat the table.
  text: z.string().min(1).max(8192),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
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

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { role, text, meta } = parsed.data;

  const admin = createAdminClient();

  // Ownership check — load the session and verify it belongs to the
  // caller's org. Same defense as /end since no client RLS protects us.
  const { data: session, error: readErr } = await admin
    .from('voice_sessions')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.org_id !== org.org_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { error: insertErr } = await admin
    .from('voice_messages')
    .insert({
      session_id: id,
      role,
      text,
      meta: meta ?? null,
    });
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
