import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getAdminAnalytics, listAllSignupEmails } from '@/lib/admin/analytics';
import { AdminAnalytics } from '@/components/admin-analytics';
import { env } from '@/env';

// Super-admin-only. Renders notFound() for all other accounts so the
// route's existence is not observable — matches the /admin/api-usage and
// /admin/payments gate. This page is the native DB behavioural dashboard
// (Track A); the PostHog embed (#118) rides along as a secondary tab.
export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // Default view: last 30 days, internal accounts excluded. The signup
  // roster is filter-independent (전수), so it's fetched once alongside.
  const [report, signups] = await Promise.all([
    getAdminAnalytics({ period: '30d', excludeInternal: true }),
    listAllSignupEmails(),
  ]);

  return (
    <div className="px-2 py-6">
      <AdminAnalytics
        initialReport={report}
        initialSignups={signups}
        embedUrl={env.POSTHOG_EMBED_URL ?? null}
      />
    </div>
  );
}
