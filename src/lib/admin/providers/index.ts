import type { AdminUsageReport, ProviderUsage } from '../types';
import { getAnthropicUsage } from './anthropic';
import { getOpenAiUsage } from './openai';
import { getDeepgramUsage } from './deepgram';
import { getElevenLabsUsage } from './elevenlabs';
import { getStripeUsage } from './stripe';
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
  ]);
  const providers: ProviderUsage[] = [...live, ...getConfiguredOnlyProviders()];
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
