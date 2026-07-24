import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimPendingInvites } from '@/lib/scheduling/access';
import { SwitchAccountButton } from './switch-account';

// Org-invite accept landing (outside the (app) auth group so it controls its
// own redirect). Flow: email link → here → if signed out, bounce through
// /login?next=… back here → claim the pending organization_members row for this
// email → drop the now-full member into the shared scheduling workspace. If no
// invite matches this account, render a diagnosable notice instead of a silent
// 404 (the invitee likely signed in with a different address than the invite).
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
  const claimed = await claimPendingInvites(admin, user.id, user.email);

  // Re-check membership after the claim (claimed rows + any prior membership).
  const { data: memberships } = await admin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id);
  const memberCount = memberships?.length ?? 0;

  // Diagnostic: on the next stuck report this pins the cause immediately —
  // which email logged in vs how many invite rows it matched.
  console.log(
    `[invite/accept] email=${user.email ?? '(none)'} claimed=${claimed} memberships=${memberCount}`,
  );

  if (memberCount > 0) {
    // Full member now — send them to the shared scheduling workspace.
    redirect(`/${locale}/admin/recruiting-scheduling`);
  }

  // No invite matched this account. Instead of a silent 404 (undiagnosable),
  // tell the invitee which address they arrived on and let them retry with the
  // one the invite was sent to.
  const t = await getTranslations({ locale, namespace: 'InviteAccept' });
  return (
    <main className="min-h-dvh bg-paper flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md border border-line rounded-sm bg-paper p-8 text-center">
        <h1 className="text-ink text-lg font-semibold">{t('notFoundTitle')}</h1>
        <p className="mt-4 text-mute text-sm leading-relaxed">
          {t('notFoundBody', { email: user.email ?? '' })}
        </p>
        <div className="mt-8 flex justify-center">
          <SwitchAccountButton acceptPath={acceptPath} label={t('switchAccount')} />
        </div>
      </div>
    </main>
  );
}
