import type { AdminUsageReport, ProviderUsage } from '../types';
import { getAnthropicUsage } from './anthropic';
import { getOpenAiUsage } from './openai';
import { getDeepgramUsage } from './deepgram';
import { getElevenLabsUsage } from './elevenlabs';
import { getStripeUsage } from './stripe';
import { getSupabaseUsage } from './supabase';
import { getConfiguredOnlyProviders } from './configured-only';

// Aggregator. Live-fetch providers run in parallel; configured-only
// ones are synchronous lookups against `process.env`. Each fetch is
// best-effort — a single provider failure doesn't fail the report.
export async function getAdminUsageReport(): Promise<AdminUsageReport> {
  const live = await Promise.all([
    safe(getAnthropicUsage),
    safe(getOpenAiUsage),
    safe(getDeepgramUsage),
    safe(getElevenLabsUsage),
    safe(getStripeUsage),
    safe(getSupabaseUsage),
  ]);
  // Supabase moved out of configured-only since we now fetch live, so
  // we filter it out of the configured-only list to avoid duplication.
  const configured = getConfiguredOnlyProviders().filter((p) => p.id !== 'supabase');
  const providers: ProviderUsage[] = [...live, ...configured];
  return {
    generatedAt: new Date().toISOString(),
    providers,
  };
}

async function safe(fn: () => Promise<ProviderUsage>): Promise<ProviderUsage> {
  try {
    return await fn();
  } catch (e) {
    return {
      id: fn.name,
      name: fn.name,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      envKeys: [],
    };
  }
}
