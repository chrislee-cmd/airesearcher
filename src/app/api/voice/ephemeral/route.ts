// Voice Concierge — issue an OpenAI Realtime ephemeral client secret
// (ek_...) and create the voice_sessions row the client will tag every
// follow-up message with.
//
// Flow:
//   1. Auth: getCurrentUser + getActiveOrg (same pattern as desk/quotes).
//   2. PREVIEW gate: refuse if voice_concierge is preview-only and the
//      org isn't is_unlimited.
//   3. Quota: sum duration_sec of today's voice_sessions for this org;
//      refuse with 429 if >= VOICE_DAILY_LIMIT_SEC.
//   4. Insert voice_sessions row (service-role) to get sessionId.
//   5. Mint ek_... via client.realtime.clientSecrets.create() with model,
//      voice, and the buildInstructions() system prompt baked in. Tools
//      are intentionally NOT passed (PR3 wires those).
//   6. Return { apiKey, sessionId, expiresAt }.

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { PREVIEW_FEATURES } from '@/lib/features';
import {
  VOICE_MODEL,
  VOICE_OPENAI_VOICE,
  VOICE_DAILY_LIMIT_SEC,
} from '@/lib/voice/config';
import { buildInstructions } from '@/lib/voice/instructions';

export const runtime = 'nodejs';

const Body = z.object({
  // The route the user opened the FAB on. Stored for analytics
  // (design §12.8) and fed into the initial instructions render.
  route: z.string().min(1).max(256).optional().default('/dashboard'),
  locale: z.enum(['ko', 'en']).optional().default('ko'),
});

export async function POST(request: Request) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // ── 2. PREVIEW gate ─────────────────────────────────────────────────
  // Mirrors requirePreviewAccess() but inlined because that helper does
  // a server-side redirect — we need to return JSON for the API caller.
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

  // ── 3. Quota check ─────────────────────────────────────────────────
  // UTC day boundary is fine for V1 — the user-confirmed policy is
  // "10min/org/day cumulative". Switching to org-local TZ is a
  // PR4 cleanup if usage patterns warrant it.
  const admin = createAdminClient();
  const todayStartUtc = new Date();
  todayStartUtc.setUTCHours(0, 0, 0, 0);

  const { data: usageRows, error: usageErr } = await admin
    .from('voice_sessions')
    .select('duration_sec')
    .eq('org_id', org.org_id)
    .gte('started_at', todayStartUtc.toISOString());
  if (usageErr) {
    return NextResponse.json({ error: usageErr.message }, { status: 500 });
  }
  const usedSec = (usageRows ?? []).reduce(
    (sum, row) => sum + (row.duration_sec ?? 0),
    0,
  );
  if (usedSec >= VOICE_DAILY_LIMIT_SEC) {
    return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
  }

  // ── 4. Insert session row ───────────────────────────────────────────
  // Service-role insert because PR1's RLS intentionally has no INSERT
  // policy (forgery defense — see migration 0023 comment).
  const { data: session, error: insertErr } = await admin
    .from('voice_sessions')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      locale,
      entry_route: route,
    })
    .select('id')
    .single();
  if (insertErr || !session) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'session_insert_failed' },
      { status: 500 },
    );
  }

  // ── 5. Mint ephemeral client secret ────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Clean up the orphaned session row so it doesn't pollute quota.
    await admin.from('voice_sessions').delete().eq('id', session.id);
    return NextResponse.json({ error: 'openai_not_configured' }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey });

  // Build the system prompt once and return it to the client alongside the
  // ephemeral. The Agents SDK overrides whatever instructions live in the
  // ephemeral session config with the RealtimeAgent ctor's instructions on
  // `session.connect()` — so the authoritative path is the response field,
  // not the clientSecrets.create payload. We still set it on the ephemeral
  // as a safety-net default in case the SDK ever stops auto-overriding.
  const instructions = buildInstructions({
    route,
    locale,
    // The PREVIEW gate above already guarantees isUnlimited when we
    // reach this point. When voice_concierge GA's out of PREVIEW_FEATURES,
    // re-resolve flags.isUnlimited from the org row explicitly.
    hasUnlimited: true,
  });

  try {
    const ek = await openai.realtime.clientSecrets.create({
      session: {
        type: 'realtime',
        model: VOICE_MODEL,
        instructions,
        audio: {
          output: { voice: VOICE_OPENAI_VOICE },
        },
        // tools: intentionally omitted — PR3 wires navigate/getCredits/etc.
      },
    });

    return NextResponse.json({
      apiKey: ek.value,
      sessionId: session.id,
      expiresAt: ek.expires_at,
      instructions,
    });
  } catch (err) {
    // Clean up the orphaned session row on OpenAI failure so the user
    // can retry without burning a quota slot.
    await admin.from('voice_sessions').delete().eq('id', session.id);
    const message = err instanceof Error ? err.message : 'ephemeral_failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
