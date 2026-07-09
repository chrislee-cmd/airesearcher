import { env } from '@/env';
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
  {
    id: 'twelvelabs',
    name: 'TwelveLabs',
    envKeys: ['TWELVELABS_API_KEY', 'TWELVELABS_ANALYZE_INDEX_ID'],
    dashboardUrl: 'https://playground.twelvelabs.io/billing',
    note: '비디오 분석 / 인덱스 — 사용량 = video minute',
  },
  {
    id: 'livekit',
    name: 'LiveKit',
    envKeys: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'],
    dashboardUrl: 'https://cloud.livekit.io/projects',
    note: '동시통역 viewer / publisher 연결 — 사용량 = connection minute',
  },
  {
    id: 'lemonsqueezy',
    name: 'Lemonsqueezy',
    envKeys: [
      'LEMONSQUEEZY_API_KEY',
      'LEMONSQUEEZY_STORE_ID_KRW',
      'LEMONSQUEEZY_STORE_ID_USD',
    ],
    dashboardUrl: 'https://app.lemonsqueezy.com/dashboard',
    note: '결제 처리 — 수익은 Dashboard 에서 확인',
  },
  {
    id: 'upstash',
    name: 'Upstash Redis',
    envKeys: ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    dashboardUrl: 'https://console.upstash.com/redis',
    note: 'rate limit (application-rate-limit, #422) — 사용량 = req / 10k',
  },
  {
    id: 'notion',
    name: 'Notion',
    envKeys: ['NOTION_API_TOKEN', 'NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
    dashboardUrl: 'https://www.notion.so/my-integrations',
    note: 'share-to-Notion 통합 — API 무료',
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    envKeys: ['WORDPRESS_API_URL'],
    dashboardUrl: '',
    note: '자체 호스팅 instance — API 키 / 비용 별도',
  },
];

export function getConfiguredOnlyProviders(): ProviderUsage[] {
  return SPECS.map((spec) => {
    const envKeys = spec.envKeys.map((key) => ({
      key,
      present: !!(env as Record<string, string | undefined>)[key],
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
