import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimPendingInvites } from '@/lib/scheduling/access';

// Org-invite accept landing (outside the (app) auth group so it controls its
// own redirect). Flow: email link → here → if signed out, bounce through
// /login?next=… back here → claim the pending organization_members row for this
// email → drop the now-full member into the shared scheduling workspace.
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  const acceptPath = `/${locale}/invite/accept`;
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(acceptPath)}`);
  }

  const admin = createAdminClient();
  await claimPendingInvites(admin, user.id, user.email);

  // Full member now — send them to the shared scheduling workspace.
  redirect(`/${locale}/admin/recruiting-scheduling`);
}
