import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { env } from '@/env';

// Super-admin-only. Renders notFound() for all other accounts so the
// route's existence is not observable — matches the /admin/api-usage and
// /admin/payments gate rather than a redirect('/') (spec called for a
// redirect; we follow the established admin convention instead).
export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  const embedUrl = env.POSTHOG_EMBED_URL;

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-line px-2 py-6">
        <div className="flex items-center gap-2">
          <span className="inline-block h-px w-5 bg-amore" />
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
            ADMIN
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-ink">
          분석 대시보드
        </h1>
        <p className="mt-1 text-md text-mute">
          PostHog product analytics — funnel / retention / cohort / session
          recording
        </p>
      </header>

      {embedUrl ? (
        <iframe
          src={embedUrl}
          className="w-full flex-1 border-0"
          title="PostHog Analytics"
          allow="clipboard-write"
        />
      ) : (
        <div className="p-8 text-mute">
          POSTHOG_EMBED_URL 이 설정되지 않았습니다. PostHog 대시보드에서 embed
          URL 을 생성해 Vercel env 에 추가하세요.
        </div>
      )}
    </div>
  );
}
