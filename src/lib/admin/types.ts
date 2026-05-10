// Cross-provider usage shape. Each provider exposes wildly different
// data — some give granular $ cost (Anthropic admin), some only character
// quotas (ElevenLabs), some only revenue balance (Stripe). We collapse
// to a common envelope so the UI doesn't need to special-case each row.

export type ProviderStatus =
  // Live data fetched successfully
  | 'ok'
  // Env keys exist but the provider does not expose a usage API (or
  // requires an admin key we don't have). UI shows "configured" + link.
  | 'no-admin-api'
  // Env keys missing entirely.
  | 'unconfigured'
  // Live fetch failed (network, 401, etc). `error` carries the message.
  | 'error';

export type UsageMetric = {
  // Short human label, e.g. "입력 토큰" / "사용 문자수" / "요청".
  label: string;
  // Pre-formatted display string. Numeric formatting is the provider
  // module's responsibility — different providers want different units.
  value: string;
};

export type ProviderUsage = {
  id: string;
  name: string;
  status: ProviderStatus;
  error?: string;
  // What time window the usage/cost numbers cover. Renderers show this
  // verbatim so each provider can describe its own window.
  periodLabel?: string;
  // List of usage counters in display order.
  metrics?: UsageMetric[];
  // Total spent in the period, if known. USD because every provider we
  // hit prices in USD; the UI converts at render time if needed.
  costUsd?: number;
  // Remaining prepaid balance / quota in USD if the provider exposes it.
  balanceUsd?: number;
  // Free-form remaining balance label for non-USD quotas (e.g. ElevenLabs
  // character quota: "120,000자 남음"). Shown alongside balanceUsd.
  balanceLabel?: string;
  dashboardUrl?: string;
  envKeys: { key: string; present: boolean }[];
};

export type AdminUsageReport = {
  generatedAt: string;
  providers: ProviderUsage[];
};
