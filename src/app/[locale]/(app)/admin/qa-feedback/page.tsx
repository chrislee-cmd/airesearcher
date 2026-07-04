import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

  const enriched: QaFeedbackRow[] = (feedbacks ?? []).map((f) => ({
    ...f,
    user_email: profileMap.get(f.user_id)?.email ?? '(unknown)',
    user_name: profileMap.get(f.user_id)?.full_name ?? null,
  }));

  return <QaFeedbackList feedbacks={enriched} />;
}
