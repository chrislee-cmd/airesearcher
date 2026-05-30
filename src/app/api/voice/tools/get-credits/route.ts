// Voice Concierge — server helper for the `getCredits` tool.
//
// Returns the same balance the user already sees in the sidebar/credits
// page (via getCreditsStatus → organizations.credit_balance). We reuse
// the existing helper instead of writing a fresh query so the number
// the model speaks is always the number the UI shows.
//
// Plan signal: this repo doesn't have a `plan` column on organizations
// (it's a credit-only model). We surface `is_unlimited` as the plan
// signal — 'unlimited' for super-admin / beta orgs, 'credits' for
// everyone else. If a real plan column lands later, swap this out.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getCreditsStatus } from '@/lib/credits';
import { PREVIEW_FEATURES } from '@/lib/features';
import { getOrgFlags } from '@/lib/org';

export const runtime = 'nodejs';

export async function POST() {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // ── PREVIEW gate (same as /ephemeral) ───────────────────────────────
  // The model should never reach here in production unless voice_concierge
  // is GA, but we keep this gate symmetric with /ephemeral so a leaked
  // route can't be hit by non-beta orgs.
  if (PREVIEW_FEATURES.has('voice_concierge')) {
    const flags = await getOrgFlags(org.org_id);
    if (!flags.isUnlimited) {
      return NextResponse.json({ error: 'preview_only' }, { status: 403 });
    }
  }

  // ── Read balance via the existing helper ────────────────────────────
  const status = await getCreditsStatus(org.org_id);

  return NextResponse.json({
    credits: status.balance,
    // No real plan column exists yet — surface unlimited vs. credits so
    // the model can phrase things like "You're on unlimited" vs.
    // "You have X credits left". null is reserved for future plan tiers.
    plan: status.isUnlimited ? 'unlimited' : 'credits',
  });
}
