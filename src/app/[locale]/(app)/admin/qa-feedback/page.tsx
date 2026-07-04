import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { QaFeedbackList, type QaFeedbackRow } from '@/components/qa/qa-feedback-list';

// Super-admin-only page. We render with `notFound()` for non-admins so the
// route's existence isn't observable to other accounts — matching the other
// /admin/* pages (spec called for redirect('/'), but the canonical admin gate
// here is getCurrentUser + isSuperAdminEmail + notFound).
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // The qa_feedbacks super-admin RLS policy lets chris.lee@ read every row.
  // We deliberately DON'T PostgREST-embed profiles here: qa_feedbacks.user_id
  // and profiles.id both point at auth.users(id) but have no direct FK to each
  // other, so an embed would silently return 0 rows (PROJECT.md §7.10). Split
  // into a second .in() query instead.
  const supabase = await createClient();
  const { data: feedbacks } = await supabase
    .from('qa_feedbacks')
    .select(
      'id, user_id, session_id, audio_storage_key, transcript, page_url, duration_seconds, status, meta, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  const userIds = [...new Set((feedbacks ?? []).map((f) => f.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Resolve identities from auth.users (service role) rather than trusting the
  // profiles table: accounts created before the handle_new_user trigger — or
  // whose profile insert failed — have no profiles row, which previously
  // rendered every recording as "(unknown)". auth.users is the source of truth
  // for email; profiles is only a name fallback. One getUserById per distinct
  // tester (a small set), run in parallel.
  const admin = createAdminClient();
  const identities = new Map<string, { email: string; name: string | null }>();
  await Promise.all(
    userIds.map(async (uid) => {
      const prof = profileMap.get(uid);
      const { data: authData } = await admin.auth.admin.getUserById(uid);
      const authUser = authData?.user;
      const metaName =
        typeof authUser?.user_metadata?.full_name === 'string'
          ? authUser.user_metadata.full_name
          : null;
      identities.set(uid, {
        email: authUser?.email ?? prof?.email ?? '(unknown)',
        name: prof?.full_name ?? metaName,
      });
    }),
  );

  const enriched: QaFeedbackRow[] = (feedbacks ?? []).map((f) => ({
    ...f,
    user_email: identities.get(f.user_id)?.email ?? '(unknown)',
    user_name: identities.get(f.user_id)?.name ?? null,
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-end border-b border-line-soft px-4 py-2">
        <Link
          href="/admin/qa-testers"
          className="text-sm text-mute hover:text-amore transition-colors"
        >
          ⚙ QA 계정 관리
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <QaFeedbackList feedbacks={enriched} />
      </div>
    </div>
  );
}
