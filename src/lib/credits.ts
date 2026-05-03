import { createClient } from '@/lib/supabase/server';
import type { FeatureKey } from '@/lib/features';
import { FEATURE_COSTS } from '@/lib/features';

export async function getOrgCredits(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('credit_balance')
    .eq('id', orgId)
    .single();
  return data?.credit_balance ?? 0;
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
