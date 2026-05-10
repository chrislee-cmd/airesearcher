import type { ProviderUsage } from '../types';

// Anthropic exposes per-organization usage and cost reports only via an
// Admin API (`sk-ant-admin-...`), not via the regular API key. We try
// the cost_report endpoint when the admin key is present; otherwise we
// surface the row as "no admin API" with a dashboard link.
//
// Docs (subject to change — verify before relying):
//   https://docs.anthropic.com/en/api/admin-api/usage-cost
const COST_REPORT_URL = 'https://api.anthropic.com/v1/organizations/cost_report';

function envFlags() {
  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  const adminKey = !!process.env.ANTHROPIC_ADMIN_KEY;
  return { apiKey, adminKey };
}

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function getAnthropicUsage(): Promise<ProviderUsage> {
  const { apiKey, adminKey } = envFlags();
  const envKeys = [
    { key: 'ANTHROPIC_API_KEY', present: apiKey },
    { key: 'ANTHROPIC_ADMIN_KEY', present: adminKey },
  ];
  const dashboardUrl = 'https://console.anthropic.com/settings/usage';

  if (!apiKey && !adminKey) {
    return {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  if (!adminKey) {
    return {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      status: 'no-admin-api',
      dashboardUrl,
      envKeys,
      error: 'ANTHROPIC_ADMIN_KEY 미설정 — 사용량/비용은 Anthropic 콘솔에서 확인',
    };
  }

  try {
    const url = new URL(COST_REPORT_URL);
    url.searchParams.set('starting_at', startOfMonthIso());
    const res = await fetch(url, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_ADMIN_KEY!,
        'anthropic-version': '2023-06-01',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    const json = (await res.json()) as {
      data?: { results?: { amount?: { value?: number } }[] }[];
    };
    let costUsd = 0;
    for (const bucket of json.data ?? []) {
      for (const r of bucket.results ?? []) {
        const v = Number(r.amount?.value);
        if (Number.isFinite(v)) costUsd += v;
      }
    }
    return {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      status: 'ok',
      periodLabel: '이번 달 누적',
      costUsd,
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
