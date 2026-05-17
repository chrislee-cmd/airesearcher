import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { FeatureKey } from '@/lib/features';
import { FEATURE_COSTS } from '@/lib/features';

// cache()d so layout + /credits page share a single Supabase round-trip.
export const getOrgCredits = cache(async (orgId: string): Promise<number> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('credit_balance')
    .eq('id', orgId)
    .single();
  return data?.credit_balance ?? 0;
});

export type CreditsStatus = {
  balance: number;
  trialEndsAt: string | null; // ISO; null after backfill (legacy orgs)
  isUnlimited: boolean;
  isTrialActive: boolean;
};

/** Status snapshot the UI uses to render the trial badge / paywall gating. */
export async function getCreditsStatus(orgId: string): Promise<CreditsStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('credit_balance, trial_ends_at, is_unlimited')
    .eq('id', orgId)
    .single();
  const trialEndsAt = (data?.trial_ends_at as string | null) ?? null;
  const isTrialActive =
    trialEndsAt != null && new Date(trialEndsAt).getTime() > Date.now();
  return {
    balance: (data?.credit_balance as number | null) ?? 0,
    trialEndsAt,
    isUnlimited: Boolean(data?.is_unlimited),
    isTrialActive,
  };
}

export async function spendCredits(
  orgId: string,
  feature: FeatureKey,
  generationId?: string,
): Promise<{ ok: true } | { ok: false; reason: 'insufficient' | 'forbidden' }> {
  const supabase = await createClient();
  const cost = FEATURE_COSTS[feature];

  const { data, error } = await supabase.rpc('spend_credits', {
    p_org_id: orgId,
    p_amount: cost,
    p_feature: feature,
    p_generation_id: generationId ?? null,
  });

  if (error) return { ok: false, reason: 'forbidden' };
  if (!data) return { ok: false, reason: 'insufficient' };
  return { ok: true };
}

/**
 * Service-role variant for contexts without an `auth.uid()` (Deepgram webhook,
 * background runners). Caller passes the acting user_id explicitly so the
 * audit trail in `credit_transactions` stays attributable. The DB function is
 * granted to `service_role` only.
 */
export async function spendCreditsAdmin(
  orgId: string,
  userId: string,
  feature: FeatureKey,
  generationId?: string,
): Promise<{ ok: true } | { ok: false; reason: 'insufficient' | 'forbidden' }> {
  const admin = createAdminClient();
  const cost = FEATURE_COSTS[feature];
  const { data, error } = await admin.rpc('spend_credits_admin', {
    p_org_id: orgId,
    p_user_id: userId,
    p_amount: cost,
    p_feature: feature,
    p_generation_id: generationId ?? null,
  });
  if (error) return { ok: false, reason: 'forbidden' };
  if (!data) return { ok: false, reason: 'insufficient' };
  return { ok: true };
}

/**
 * Admin variant that takes an explicit amount instead of the feature's flat
 * cost. Used for features priced dynamically (e.g. video analyzer charges
 * by video duration).
 */
export async function spendCreditsAdminAmount(
  orgId: string,
  userId: string,
  feature: FeatureKey,
  amount: number,
  generationId?: string,
): Promise<{ ok: true } | { ok: false; reason: 'insufficient' | 'forbidden' }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('spend_credits_admin', {
    p_org_id: orgId,
    p_user_id: userId,
    p_amount: amount,
    p_feature: feature,
    p_generation_id: generationId ?? null,
  });
  if (error) return { ok: false, reason: 'forbidden' };
  if (!data) return { ok: false, reason: 'insufficient' };
  return { ok: true };
}
