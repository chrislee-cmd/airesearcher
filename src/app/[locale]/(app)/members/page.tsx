import { setRequestLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/supabase/user';
import { getActiveOrg } from '@/lib/org';
import { InviteMemberForm } from '@/components/invite-member-form';
import { MemberRow } from '@/components/member-row';

const OUTFIT_STACK = 'var(--font-outfit), var(--font-sans)';

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
  const canManage = !!org && (org.role === 'owner' || org.role === 'admin');

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <MembersHeader title={t('title')} />

      {!org ? (
        <EmptyAuthCard />
      ) : (
        <>
          {canManage && (
            <section
              className="mb-8 p-5"
              style={{
                background: 'var(--sidebar-bg)',
                border:
                  'var(--sidebar-border-width) solid var(--sidebar-border)',
                borderRadius: 'var(--sidebar-nav-radius)',
                boxShadow: 'var(--memphis-shadow-sm)',
              }}
            >
              <div
                className="mb-3 text-xs uppercase tracking-[0.22em]"
                style={{
                  fontFamily: OUTFIT_STACK,
                  fontWeight: 800,
                  color: 'var(--sidebar-border)',
                }}
              >
                {t('invite')}
              </div>
              <InviteMemberForm orgId={org.org_id} />
            </section>
          )}

          <MembersTable orgId={org.org_id} canManage={canManage} />
        </>
      )}
    </div>
  );
}

function MembersHeader({ title }: { title: string }) {
  return (
    <div
      className="mb-6 flex items-end justify-between gap-4 px-5 py-4"
      style={{
        background: 'var(--sidebar-bg-strong)',
        border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: 'var(--memphis-shadow-sm)',
      }}
    >
      <h1
        className="text-display"
        style={{
          fontFamily: OUTFIT_STACK,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'var(--sidebar-border)',
          lineHeight: 1,
        }}
      >
        {title}
      </h1>
      <span
        aria-hidden
        className="hidden h-5 w-5 sm:inline-block"
        style={{
          background: 'var(--sidebar-active-bg)',
          border: '2px solid var(--sidebar-border)',
          borderRadius: 999,
          boxShadow: 'var(--memphis-shadow-xs)',
        }}
      />
    </div>
  );
}

async function EmptyAuthCard() {
  const t = await getTranslations('Members');
  return (
    <div
      className="p-6 text-md"
      style={{
        background: 'var(--sidebar-nav-bg)',
        border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: 'var(--memphis-shadow-sm)',
        color: 'var(--sidebar-border)',
        fontFamily: OUTFIT_STACK,
        fontWeight: 600,
      }}
    >
      {t('authRequired')}
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

  // Two-step query (was one query with `profile:profiles(...)` embed).
  // organization_members.user_id and profiles.id both reference
  // auth.users(id), but there is no direct FK between the two tables —
  // PostgREST's transitive resolution silently dropped every row, so the
  // members page rendered an empty list even though the DB held 6 rows
  // (owner + 5 invited_email). Splitting the join is the smallest change
  // that side-steps the ambiguity and is robust against future schema
  // additions that don't add a direct FK.
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, role, invited_email')
    .eq('org_id', orgId);

  const memberRows = members ?? [];
  const userIds = memberRows
    .map((m) => m.user_id)
    .filter((id): id is string => !!id);
  const { data: profiles } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)
    : { data: [] as { id: string; email: string | null; full_name: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  if (memberRows.length === 0) {
    return <EmptyMembersCard canManage={canManage} />;
  }

  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--sidebar-nav-bg)',
        border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: 'var(--memphis-shadow-sm)',
      }}
    >
      <table className="w-full text-md">
        <thead
          style={{
            background: 'var(--sidebar-bg)',
            borderBottom:
              'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
          }}
        >
          <tr>
            <th
              className="px-5 py-3 text-left text-xs uppercase tracking-[0.22em]"
              style={{
                fontFamily: OUTFIT_STACK,
                fontWeight: 800,
                color: 'var(--sidebar-border)',
              }}
            >
              {t('email')}
            </th>
            <th
              className="px-5 py-3 text-left text-xs uppercase tracking-[0.22em]"
              style={{
                fontFamily: OUTFIT_STACK,
                fontWeight: 800,
                color: 'var(--sidebar-border)',
              }}
            >
              {t('role')}
            </th>
            <th className="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {memberRows.map((m) => {
            const profile = m.user_id ? profileById.get(m.user_id) : null;
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

async function EmptyMembersCard({ canManage }: { canManage: boolean }) {
  const t = await getTranslations('Members');
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
      style={{
        background: 'var(--sidebar-nav-bg)',
        border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: 'var(--memphis-shadow-sm)',
      }}
    >
      <span
        aria-hidden
        className="inline-block h-10 w-10"
        style={{
          background: 'var(--sidebar-active-bg)',
          border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
          borderRadius: 999,
          boxShadow: 'var(--memphis-shadow-xs)',
        }}
      />
      <div
        className="text-2xl"
        style={{
          fontFamily: OUTFIT_STACK,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'var(--sidebar-border)',
        }}
      >
        {t('emptyTitle')}
      </div>
      <p className="max-w-[420px] text-md text-mute">
        {canManage ? t('emptyHintManage') : t('emptyHintView')}
      </p>
    </div>
  );
}
