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
  // 만료되는 무료 grant 버킷 (docs/pricing-scheme.md §5.4). `grantCredits` 는
  // **유효분** — 만료가 지났으면 잔액이 남아 있어도 0 으로 노출한다(레이지
  // 만료). `grantExpiresAt` 은 미만료일 때만 ISO 문자열, 그 외 null.
  grantCredits: number;
  grantExpiresAt: string | null;
};

/** Status snapshot the UI uses to render the trial badge / paywall gating. */
export async function getCreditsStatus(orgId: string): Promise<CreditsStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('credit_balance, trial_ends_at, is_unlimited, grant_credits, grant_expires_at')
    .eq('id', orgId)
    .single();
  const trialEndsAt = (data?.trial_ends_at as string | null) ?? null;
  const isTrialActive =
    trialEndsAt != null && new Date(trialEndsAt).getTime() > Date.now();
  const rawGrantExpiresAt = (data?.grant_expires_at as string | null) ?? null;
  const grantValid =
    rawGrantExpiresAt != null &&
    new Date(rawGrantExpiresAt).getTime() > Date.now();
  return {
    balance: (data?.credit_balance as number | null) ?? 0,
    trialEndsAt,
    isUnlimited: Boolean(data?.is_unlimited),
    isTrialActive,
    grantCredits: grantValid ? ((data?.grant_credits as number | null) ?? 0) : 0,
    grantExpiresAt: grantValid ? rawGrantExpiresAt : null,
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

/**
 * Reverses a prior charge for `generationId`. The refund amount is read
 * server-side from the original `feature_use` ledger row, so caller intent
 * and ledger truth cannot diverge. Idempotent — a retried refund returns
 * `ok: true` without re-crediting.
 *
 * Returns `not_found` when no matching charge exists for the (orgId,
 * generationId) pair — usually means the caller passed the wrong id, or
 * the original spend never completed.
 */
export async function refundCredits(
  orgId: string,
  userId: string,
  feature: FeatureKey,
  generationId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'forbidden' }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('credit_refund', {
    p_org_id: orgId,
    p_user_id: userId,
    p_feature: feature,
    p_generation_id: generationId,
  });
  if (error) return { ok: false, reason: 'forbidden' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true };
}
