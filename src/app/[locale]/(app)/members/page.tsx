import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { InviteMemberForm } from '@/components/invite-member-form';
import { MemberRow } from '@/components/member-row';
import { ChapterHeader } from '@/components/editorial';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Members');

  const user = await getCurrentUser();
  const org = user ? await getActiveOrg() : null;

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader
        title={t('title')}
        description="조직 멤버를 초대하고 권한을 관리합니다. 모든 산출물은 조직 단위로 공유되며, 역할에 따라 접근 범위가 달라집니다."
      />

      {!org ? (
        <div className="border border-line bg-paper-soft p-6 text-[12.5px] text-mute [border-radius:4px]">
          로그인 후 조직 정보가 표시됩니다.
        </div>
      ) : (
        <>
          {(org.role === 'owner' || org.role === 'admin') && (
            <div className="mb-8 border border-line bg-paper p-5 [border-radius:4px]">
              <div className="eyebrow-mute mb-3">Invite</div>
              <InviteMemberForm orgId={org.org_id} />
            </div>
          )}

          <MembersTable orgId={org.org_id} canManage={org.role === 'owner' || org.role === 'admin'} />
        </>
      )}
    </div>
  );
}

async function MembersTable({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const t = await getTranslations('Members');
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, role, invited_email, profile:profiles(email, full_name, avatar_url)')
    .eq('org_id', orgId);

  return (
    <div className="border border-line bg-paper [border-radius:4px]">
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-line">
          <tr>
            <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('email')}
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {t('role')}
            </th>
            <th className="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {(members ?? []).map((m) => {
            const profile = m.profile as unknown as
              | { email?: string; full_name?: string }
              | null;
            return (
              <MemberRow
                key={`${m.user_id ?? m.invited_email}`}
                orgId={orgId}
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
  );
}
