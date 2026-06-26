import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Baseline security headers (PR-SEC3 stage 1) — applied to every response.
// `Permissions-Policy` keeps camera/mic available for the LiveKit translate
// flow but blocks geolocation outright (we never request it).
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=()',
  },
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
