import type { ProviderUsage } from '../types';

// Supabase exposes per-organization billing/usage via the Management
// API at api.supabase.com. It needs a Personal Access Token
// (`SUPABASE_ACCESS_TOKEN`, generated from supabase.com/dashboard/
// account/tokens) — separate from the project's anon/service-role keys.
// Without that token we surface env-key presence + dashboard link.
const ORG_LIST_URL = 'https://api.supabase.com/v1/organizations';

export async function getSupabaseUsage(): Promise<ProviderUsage> {
  const projectUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessToken = !!process.env.SUPABASE_ACCESS_TOKEN;
  const envKeys = [
    { key: 'NEXT_PUBLIC_SUPABASE_URL', present: projectUrl },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', present: serviceRole },
    { key: 'SUPABASE_ACCESS_TOKEN', present: accessToken },
  ];
  const dashboardUrl = 'https://supabase.com/dashboard/project/_/settings/billing';

  if (!projectUrl) {
    return {
      id: 'supabase',
      name: 'Supabase',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  if (!accessToken) {
    return {
      id: 'supabase',
      name: 'Supabase',
      status: 'no-admin-api',
      error:
        'SUPABASE_ACCESS_TOKEN 미설정 — supabase.com/dashboard/account/tokens 에서 발급 후 등록하면 라이브 사용량이 보입니다.',
      dashboardUrl,
      envKeys,
    };
  }

  try {
    const orgRes = await fetch(ORG_LIST_URL, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN!}` },
      cache: 'no-store',
    });
    if (!orgRes.ok) throw new Error(`organizations HTTP ${orgRes.status}`);
    const orgs = (await orgRes.json()) as { id: string; name: string }[];
    const org = orgs[0];
    if (!org) throw new Error('no organizations on this token');

    // Daily-stats endpoint returns aggregated metrics per project for
    // the org. We sum across all projects to get a single number per
    // metric. This API is documented but lightly versioned — handle
    // partial response shapes defensively.
    const usageRes = await fetch(
      `https://api.supabase.com/v1/organizations/${org.id}/daily-stats`,
      {
        headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN!}` },
        cache: 'no-store',
      },
    );

    let metrics: { label: string; value: string }[] = [];
    if (usageRes.ok) {
      const json = (await usageRes.json()) as {
        attributes?: { name?: string; sum?: number; unit?: string }[];
      };
      metrics =
        json.attributes
          ?.slice(0, 4)
          .map((a) => ({
            label: a.name ?? '—',
            value: `${(a.sum ?? 0).toLocaleString('ko-KR')}${a.unit ? ` ${a.unit}` : ''}`,
          })) ?? [];
    }

    return {
      id: 'supabase',
      name: `Supabase (${org.name})`,
      status: 'ok',
      periodLabel: '이번 결제 주기',
      metrics,
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'supabase',
      name: 'Supabase',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
