'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from './ui/button';
import { Select } from './ui/select';

type Role = 'owner' | 'admin' | 'member' | 'viewer';

const OUTFIT_STACK = 'var(--font-outfit), var(--font-sans)';

// Memphis wash per role — each variant carries a distinct pop hue so
// owner/admin/member/viewer are scannable in a single glance.
const ROLE_BG: Record<Role, string> = {
  owner: 'var(--sidebar-active-bg)',  // pink — top of the hierarchy
  admin: '#ffd53d',                   // yellow-strong — privileged
  member: '#cdebd9',                  // mint — standard
  viewer: '#cfe6ff',                  // sky — read-only
};

const ROLE_TEXT: Record<Role, string> = {
  owner: 'var(--sidebar-active-text)',
  admin: 'var(--sidebar-border)',
  member: 'var(--sidebar-border)',
  viewer: 'var(--sidebar-border)',
};

export function MemberRow({
  orgId,
  userId,
  email,
  role,
  canManage,
}: {
  orgId: string;
  userId: string | null;
  email: string;
  role: Role;
  canManage: boolean;
}) {
  const t = useTranslations('Members');
  const router = useRouter();

  async function changeRole(next: string) {
    await fetch('/api/members/role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, user_id: userId, role: next }),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm('Remove member?')) return;
    await fetch('/api/members/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, user_id: userId, email }),
    });
    router.refresh();
  }

  const editable = canManage && role !== 'owner';
  const avatarLetter = (email.charAt(0) || '?').toUpperCase();

  return (
    <tr
      className="transition-colors hover:bg-[var(--sidebar-nav-bg-hover)]"
      style={{
        borderTop:
          'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
      }}
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex shrink-0 items-center justify-center"
            style={{
              width: 28,
              height: 28,
              background: 'var(--sidebar-nav-bg)',
              border:
                'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: 'var(--memphis-shadow-xs)',
              fontFamily: OUTFIT_STACK,
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '-0.02em',
              color: 'var(--sidebar-border)',
            }}
            aria-hidden
          >
            {avatarLetter}
          </span>
          <span
            className="text-md"
            style={{
              fontFamily: OUTFIT_STACK,
              fontWeight: 700,
              color: 'var(--sidebar-border)',
            }}
          >
            {email}
          </span>
        </div>
      </td>
      <td className="px-5 py-3">
        {editable ? (
          <Select
            size="sm"
            fullWidth={false}
            defaultValue={role}
            onChange={(e) => changeRole(e.target.value)}
            className="!border-0 !rounded-[var(--sidebar-nav-radius)]"
            style={{
              border:
                'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
              borderRadius: 'var(--sidebar-nav-radius)',
              background: 'var(--sidebar-nav-bg)',
              boxShadow: 'var(--memphis-shadow-xs)',
              fontFamily: OUTFIT_STACK,
              fontWeight: 700,
            }}
            options={[
              { value: 'admin', label: t('admin') },
              { value: 'member', label: t('member') },
              { value: 'viewer', label: t('viewer') },
            ]}
          />
        ) : (
          <span
            className="inline-flex items-center px-2.5 py-1 text-xs uppercase tracking-[0.18em]"
            style={{
              fontFamily: OUTFIT_STACK,
              fontWeight: 800,
              background: ROLE_BG[role],
              color: ROLE_TEXT[role],
              border:
                'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: 'var(--memphis-shadow-xs)',
            }}
          >
            {t(role)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {editable && (
          <Button
            variant="secondary"
            size="xs"
            onClick={remove}
            className="!border-0 uppercase tracking-[0.18em] transition-transform duration-[120ms] hover:-translate-y-0.5"
            style={{
              fontFamily: OUTFIT_STACK,
              fontWeight: 800,
              background: 'var(--sidebar-nav-bg)',
              color: 'var(--sidebar-border)',
              border:
                'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: 'var(--memphis-shadow-xs)',
            }}
          >
            {t('removeMember')}
          </Button>
        )}
      </td>
    </tr>
  );
}
