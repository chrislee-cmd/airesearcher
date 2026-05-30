// Voice Concierge — rebuild the system prompt for a live session.
//
// The provider calls this on every SPA route change (debounced 500ms)
// to refresh the model's "what screen is the user on?" context. We
// intentionally do NOT mint a new ephemeral or touch voice_sessions
// here — this is a free, idempotent helper. The client then feeds the
// returned string to transport.updateSessionConfig({ instructions })
// (the public RealtimeSession surface in @openai/agents-realtime v0.11.6
// does not expose session.update, see use-realtime-session.ts).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { PREVIEW_FEATURES } from '@/lib/features';
import { buildInstructions } from '@/lib/voice/instructions';

export const runtime = 'nodejs';

const Body = z.object({
  route: z.string().min(1).max(256),
  locale: z.enum(['ko', 'en']).optional().default('ko'),
});

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // ── PREVIEW gate ────────────────────────────────────────────────────
  if (PREVIEW_FEATURES.has('voice_concierge')) {
    const flags = await getOrgFlags(org.org_id);
    if (!flags.isUnlimited) {
      return NextResponse.json({ error: 'preview_only' }, { status: 403 });
    }
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { route, locale } = parsed.data;

  // PREVIEW gate above already proves isUnlimited; mirror /ephemeral.
  // When voice_concierge GA's, swap to `await getOrgFlags(...).isUnlimited`.
  const instructions = buildInstructions({
    route,
    locale,
    hasUnlimited: true,
  });

  return NextResponse.json({ instructions });
}
