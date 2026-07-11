import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { getAdminAnalytics } from '@/lib/admin/analytics';
import { AdminAnalytics } from '@/components/admin-analytics';
import { AutoRefresh } from '@/components/auto-refresh';
import { env } from '@/env';

/* ────────────────────────────────────────────────────────────────────
   Public read-only metrics view — /[locale]/status?key=<token>.

   Lives OUTSIDE the (app) auth layer, so it renders login-independent
   (always-on wall/phone monitor). The ONLY gate is the secret
   PUBLIC_DASHBOARD_TOKEN, compared in constant time. Everything is
   fail-closed:
     - token env unset            → notFound()
     - ?key missing / wrong / dup → notFound()
   notFound() (not 403) hides the route's very existence — same philosophy
   as the /admin/* super-admin gates.

   Data is getAdminAnalytics() ONLY — pre-aggregated counts, no raw rows or
   PII. listAllSignupEmails() (the signup-email roster) is deliberately NOT
   imported here, and publicView drops the roster card + gated controls in
   the shared <AdminAnalytics> component.
   ──────────────────────────────────────────────────────────────────── */

// Even if the token leaks, keep this out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Constant-time token check. timingSafeEqual throws on length mismatch, so
// gate on length first (a length difference is not itself secret). A missing
// or duplicated (?key=a&key=b → array) param fails closed.
function tokenMatches(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const expected = env.PUBLIC_DASHBOARD_TOKEN;
  // Fail closed: no token provisioned → the public view does not exist.
  if (!expected) notFound();

  const { key } = await searchParams;
  if (!tokenMatches(key, expected)) notFound();

  // Aggregate counts only. Matches the super-admin default view (last 30
  // days, internal accounts excluded) but never fetches the PII roster.
  const report = await getAdminAnalytics({
    period: '30d',
    excludeInternal: true,
  });

  return (
    <div className="px-2 py-6">
      <AutoRefresh intervalMs={60000} />
      <AdminAnalytics
        initialReport={report}
        initialSignups={{ total: 0, accounts: [] }}
        embedUrl={null}
        publicView
      />
    </div>
  );
}
