import type { ProviderUsage } from '../types';

// Providers we use but whose usage/cost is not exposed via a programmatic
// API on the keys we hold (or where the integration is so cheap/fixed
// that pulling live data is overkill). We still surface them so the
// dashboard reflects the full surface area, with a deep link to the
// provider's own dashboard.

type Spec = {
  id: string;
  name: string;
  envKeys: string[];
  dashboardUrl: string;
  note?: string;
};

const SPECS: Spec[] = [
  {
    id: 'supabase',
    name: 'Supabase',
    envKeys: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
    dashboardUrl: 'https://supabase.com/dashboard/project/_/settings/billing',
    note: '사용량/비용은 Supabase Dashboard → Billing 에서 확인',
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    envKeys: ['NEXT_PUBLIC_MIXPANEL_TOKEN'],
    dashboardUrl: 'https://mixpanel.com/settings/org/usage/',
  },
  {
    id: 'youtube',
    name: 'YouTube Data API',
    envKeys: ['YOUTUBE_API_KEY'],
    dashboardUrl: 'https://console.cloud.google.com/apis/dashboard',
    note: '쿼터/비용은 Google Cloud Console',
  },
  {
    id: 'google',
    name: 'Google OAuth',
    envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    dashboardUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'kakao',
    name: 'Kakao',
    envKeys: ['KAKAO_REST_API_KEY'],
    dashboardUrl: 'https://developers.kakao.com/console/app',
  },
  {
    id: 'naver',
    name: 'Naver',
    envKeys: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
    dashboardUrl: 'https://developers.naver.com/apps/',
  },
  {
    id: 'gmail',
    name: 'Gmail SMTP',
    envKeys: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'],
    dashboardUrl: 'https://myaccount.google.com/security',
  },
];

export function getConfiguredOnlyProviders(): ProviderUsage[] {
  return SPECS.map((spec) => {
    const envKeys = spec.envKeys.map((key) => ({
      key,
      present: !!process.env[key],
    }));
    const anyPresent = envKeys.some((k) => k.present);
    const allPresent = envKeys.every((k) => k.present);
    return {
      id: spec.id,
      name: spec.name,
      status: anyPresent ? 'no-admin-api' : 'unconfigured',
      error: anyPresent && !allPresent ? '일부 키 누락' : spec.note,
      dashboardUrl: spec.dashboardUrl,
      envKeys,
    };
  });
}
