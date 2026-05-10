import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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
};

export default withNextIntl(nextConfig);
