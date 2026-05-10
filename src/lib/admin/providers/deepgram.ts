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

    // Both endpoints can return 403 INSUFFICIENT_PERMISSIONS when the
    // API key lacks `billing:read` / `usage:read`. Capture each error
    // independently — a partial result is more useful than a hard fail.
    let balanceUsd: number | undefined;
    let balanceErr: string | undefined;
    if (balRes.ok) {
      const balJson = (await balRes.json()) as { balances?: { amount?: number }[] };
      balanceUsd = (balJson.balances ?? []).reduce(
        (acc, b) => acc + (Number(b.amount) || 0),
        0,
      );
    } else {
      balanceErr = await balRes.text().catch(() => `HTTP ${balRes.status}`);
    }

    // Deepgram's usage endpoint returns daily buckets in `results[]`,
    // not a single object — sum across the array.
    let metrics: { label: string; value: string }[] = [];
    let usageErr: string | undefined;
    if (usageRes.ok) {
      const usageJson = (await usageRes.json()) as {
        results?: { requests?: number; hours?: number }[];
      };
      const buckets = usageJson.results ?? [];
      const totals = buckets.reduce<{ requests: number; hours: number }>(
        (acc, b) => ({
          requests: acc.requests + (Number(b.requests) || 0),
          hours: acc.hours + (Number(b.hours) || 0),
        }),
        { requests: 0, hours: 0 },
      );
      metrics = [
        { label: '요청', value: totals.requests.toLocaleString('ko-KR') },
        { label: '시간', value: `${totals.hours.toFixed(2)}h` },
      ];
    } else {
      usageErr = await usageRes.text().catch(() => `HTTP ${usageRes.status}`);
    }

    // If both partial fetches failed (typical when the key has neither
    // scope), surface as error so the page tells the operator what to
    // do instead of pretending to be live.
    if (balanceErr && usageErr) {
      return {
        id: 'deepgram',
        name: 'Deepgram',
        status: 'error',
        error:
          'API 키에 usage:read 또는 billing:read 스코프가 없습니다. Deepgram Console → Settings → API Keys 에서 권한 추가가 필요합니다.',
        dashboardUrl,
        envKeys,
      };
    }

    return {
      id: 'deepgram',
      name: 'Deepgram',
      status: 'ok',
      periodLabel: `${startOfMonthIsoDate()} – ${todayIso()}`,
      metrics,
      balanceUsd,
      // Soft note when only one of the two reads succeeded.
      error:
        balanceErr && !usageErr
          ? '잔액 조회 실패 — billing:read 스코프가 필요합니다.'
          : !balanceErr && usageErr
            ? '사용량 조회 실패 — usage:read 스코프가 필요합니다.'
            : undefined,
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
