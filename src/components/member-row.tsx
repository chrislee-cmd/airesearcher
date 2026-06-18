'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from './ui/button';
import { Select } from './ui/select';

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
  role: 'owner' | 'admin' | 'member' | 'viewer';
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

  return (
    <tr className="border-t border-line-soft">
      <td className="px-5 py-3 text-ink-2">{email}</td>
      <td className="px-5 py-3">
        {editable ? (
          <Select
            size="sm"
            fullWidth={false}
            defaultValue={role}
            onChange={(e) => changeRole(e.target.value)}
            options={[
              { value: 'admin', label: t('admin') },
              { value: 'member', label: t('member') },
              { value: 'viewer', label: t('viewer') },
            ]}
          />
        ) : (
          <span className="text-sm uppercase tracking-[0.18em] text-mute-soft">
            {t(role)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {editable && (
          <Button
            variant="destructive-link"
            size="xs"
            onClick={remove}
            className="!px-0 !py-0 !text-sm uppercase tracking-[0.18em]"
          >
            {t('removeMember')}
          </Button>
        )}
      </td>
    </tr>
  );
}
