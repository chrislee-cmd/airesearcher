// AI 동시통역 — create a new realtime translate session.
//
// Foundation PR: persistence only. OpenAI Realtime ephemeral and LiveKit
// token issuance land in PR #2 (host pipeline).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';

const Body = z.object({
  source_lang: z.string().min(2).max(8).default('ko'),
  target_lang: z.string().min(2).max(8).default('en'),
  record_enabled: z.boolean().default(true),
});

export async function POST(request: Request) {
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
  const { source_lang, target_lang, record_enabled } = parsed.data;

  const { data, error } = await supabase
    .from('translate_sessions')
    .insert({
      org_id: org.org_id,
      host_user_id: user.id,
      source_lang,
      target_lang,
      record_enabled,
      status: 'idle',
    })
    .select('id, source_lang, target_lang, status, record_enabled')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'create_failed' },
      { status: 500 },
    );
  }

  // PR #2: also issue OpenAI ephemeral client_secret + LiveKit host token here.
  return NextResponse.json({
    session: { ...data, livekit_room: `translate:${data.id}` },
  });
}
