// AI 동시통역 — persist finalized caption.
//
// The host browser holds the OpenAI Realtime data channel and the
// finalized transcript events. After each `completed`/`done` event it
// POSTs the segment here. We:
//   - confirm the caller is the host of the session
//   - confirm the session has record_enabled=true (host policy)
//   - insert via service role (translate_messages is server-write only)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  kind: z.enum(['input', 'output']),
  text: z.string().min(1).max(8000),
  lang: z.string().min(2).max(8).optional(),
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

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const { data: session, error: readErr } = await supabase
    .from('translate_sessions')
    .select('id, host_user_id, status, record_enabled')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.host_user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (session.status === 'ended') {
    return NextResponse.json({ error: 'session_ended' }, { status: 410 });
  }
  if (!session.record_enabled) {
    // Host opted out of recording — accept the call but persist nothing.
    return NextResponse.json({ ok: true, recorded: false });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('translate_messages').insert({
    session_id: id,
    kind: parsed.data.kind,
    text: parsed.data.text,
    lang: parsed.data.lang ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, recorded: true });
}
