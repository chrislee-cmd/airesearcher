import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { InviteMemberForm } from '@/components/invite-member-form';
import { MemberRow } from '@/components/member-row';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Members');

  const org = await getActiveOrg();
  if (!org) return <div className="text-sm text-neutral-500">No organization.</div>;

  const supabase = await createClient();
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, role, invited_email, profile:profiles(email, full_name, avatar_url)')
    .eq('org_id', org.org_id);

  const canManage = org.role === 'owner' || org.role === 'admin';

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {canManage && (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <InviteMemberForm orgId={org.org_id} />
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/50">
            <tr>
              <th className="px-4 py-2">{t('email')}</th>
              <th className="px-4 py-2">{t('role')}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const profile = m.profile as unknown as { email?: string; full_name?: string } | null;
              return (
                <MemberRow
                  key={`${m.user_id ?? m.invited_email}`}
                  orgId={org.org_id}
                  userId={m.user_id}
                  email={profile?.email ?? m.invited_email ?? ''}
                  role={m.role as 'owner' | 'admin' | 'member' | 'viewer'}
                  canManage={canManage}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
