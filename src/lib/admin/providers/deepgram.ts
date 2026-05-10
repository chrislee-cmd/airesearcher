import type { ProviderUsage } from '../types';

// Deepgram exposes balance + usage per project. We pick the first
// project the key has access to and read its balance and current-month
// usage summary.
//
// Docs: https://developers.deepgram.com/reference/management-api
const BASE = 'https://api.deepgram.com/v1';

function authHeaders() {
  return { Authorization: `Token ${process.env.DEEPGRAM_API_KEY!}` };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function startOfMonthIsoDate(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export async function getDeepgramUsage(): Promise<ProviderUsage> {
  const present = !!process.env.DEEPGRAM_API_KEY;
  const envKeys = [{ key: 'DEEPGRAM_API_KEY', present }];
  const dashboardUrl = 'https://console.deepgram.com/usage';

  if (!present) {
    return {
      id: 'deepgram',
      name: 'Deepgram',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  try {
    const projRes = await fetch(`${BASE}/projects`, {
      headers: authHeaders(),
      cache: 'no-store',
    });
    if (!projRes.ok) throw new Error(`projects HTTP ${projRes.status}`);
    const projJson = (await projRes.json()) as { projects?: { project_id: string; name?: string }[] };
    const project = projJson.projects?.[0];
    if (!project) throw new Error('no projects');

    const [balRes, usageRes] = await Promise.all([
      fetch(`${BASE}/projects/${project.project_id}/balances`, {
        headers: authHeaders(),
        cache: 'no-store',
      }),
      fetch(
        `${BASE}/projects/${project.project_id}/usage?start=${startOfMonthIsoDate()}&end=${todayIso()}`,
        { headers: authHeaders(), cache: 'no-store' },
      ),
    ]);

    let balanceUsd: number | undefined;
    if (balRes.ok) {
      const balJson = (await balRes.json()) as { balances?: { amount?: number }[] };
      balanceUsd = (balJson.balances ?? []).reduce(
        (acc, b) => acc + (Number(b.amount) || 0),
        0,
      );
    }

    let metrics: { label: string; value: string }[] = [];
    if (usageRes.ok) {
      const usageJson = (await usageRes.json()) as {
        results?: {
          requests?: number;
          hours?: number;
        };
      };
      const r = usageJson.results;
      if (r) {
        metrics = [
          { label: '요청', value: (r.requests ?? 0).toLocaleString('ko-KR') },
          { label: '시간', value: `${(r.hours ?? 0).toFixed(2)}h` },
        ];
      }
    }

    return {
      id: 'deepgram',
      name: 'Deepgram',
      status: 'ok',
      periodLabel: `${startOfMonthIsoDate()} – ${todayIso()}`,
      metrics,
      balanceUsd,
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'deepgram',
      name: 'Deepgram',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
