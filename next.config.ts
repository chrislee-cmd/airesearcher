import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Baseline security headers (PR-SEC3 stage 1) — applied to every response.
// `Permissions-Policy` keeps camera/mic available for the LiveKit translate
// flow but blocks geolocation outright (we never request it).
const baseSecurityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // SAMEORIGIN (not DENY) so the app can frame its own pages — required by the
  // /design-system "Recently Changed" live preview gallery, which iframes real
  // app routes. Cross-origin framing (clickjacking) stays blocked.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=()',
  },
];

// PR-SEC3 stage 2 — Content Security Policy in report-only mode.
// Enforced version (with nonce) is deferred to stage 3 after a week of
// violation monitoring on preview/prod. Origin allowlist is derived from
// runtime call sites (see PROJECT.md §12.2) — third parties currently
// reached from the browser:
//   - Supabase (REST + realtime websocket): https/wss://*.supabase.co
//   - LiveKit cloud (translate room media): https/wss://*.livekit.cloud
//   - Mixpanel browser SDK: https://api*.mixpanel.com, https://*.mxpnl.com
//   - Vercel Speed Insights / Analytics beacons: https://*.vercel-insights.com
//   - Google Fonts + Pretendard CDN: fonts.googleapis.com / gstatic.com /
//     cdn.jsdelivr.net
// `'unsafe-inline'` / `'unsafe-eval'` stay until stage 3 swaps to nonce.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  [
    "connect-src 'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://*.livekit.cloud',
    'wss://*.livekit.cloud',
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://api.mixpanel.com',
    'https://api-js.mixpanel.com',
    'https://*.mxpnl.com',
    'https://*.vercel-insights.com',
    'https://vitals.vercel-insights.com',
  ].join(' '),
  "frame-src 'self' https:",
  // 'self' (not 'none') to keep parity with X-Frame-Options: SAMEORIGIN — the
  // /design-system preview gallery frames same-origin app routes. Kept aligned
  // now so the eventual enforced-CSP switch (stage 3) doesn't break it.
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  ...baseSecurityHeaders,
  { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
];

const nextConfig: NextConfig = {
  // @ffmpeg-installer/ffmpeg does a runtime require() of a platform-specific
  // binary package (e.g. @ffmpeg-installer/linux-x64), which Turbopack's
  // static module resolver cannot trace. Mark it external so it gets
  // loaded from node_modules at runtime instead of bundled.
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  // Re-use client-cached page segments for short windows so back/forward
  // and quick return visits don't trigger full SSR. Defaults are 0s for
  // dynamic (off) and 5min for static prefetched. We keep static low-ish
  // (60s) since sidebar/dashboard data can change after a job completes,
  // and turn dynamic on for 30s so tab-bouncing within the app feels
  // instant. Layouts are still shared across navigations regardless.
  // Docs: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
