import type { ProviderUsage } from '../types';

// OpenAI exposes per-org cost/usage via the Organization Costs API
// (https://platform.openai.com/docs/api-reference/usage). It needs an
// admin key (`sk-admin-...`). The legacy `/v1/dashboard/billing/...`
// endpoints are deprecated. Without an admin key we surface the row as
// "no admin API" + dashboard link.
const COSTS_URL = 'https://api.openai.com/v1/organization/costs';

function envFlags() {
  const apiKey = !!process.env.OPENAI_API_KEY;
  const adminKey = !!process.env.OPENAI_ADMIN_KEY;
  return { apiKey, adminKey };
}

function unixStartOfMonth(): number {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

export async function getOpenAiUsage(): Promise<ProviderUsage> {
  const { apiKey, adminKey } = envFlags();
  const envKeys = [
    { key: 'OPENAI_API_KEY', present: apiKey },
    { key: 'OPENAI_ADMIN_KEY', present: adminKey },
  ];
  const dashboardUrl = 'https://platform.openai.com/usage';

  if (!apiKey && !adminKey) {
    return {
      id: 'openai',
      name: 'OpenAI',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  if (!adminKey) {
    return {
      id: 'openai',
      name: 'OpenAI',
      status: 'no-admin-api',
      dashboardUrl,
      envKeys,
      error: 'OPENAI_ADMIN_KEY 미설정 — 사용량/비용은 OpenAI 콘솔에서 확인',
    };
  }

  try {
    const url = new URL(COSTS_URL);
    url.searchParams.set('start_time', String(unixStartOfMonth()));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY!}` },
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
      id: 'openai',
      name: 'OpenAI',
      status: 'ok',
      periodLabel: '이번 달 누적',
      costUsd,
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'openai',
      name: 'OpenAI',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
