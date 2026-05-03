'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

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
    <tr className="border-t border-neutral-100 dark:border-neutral-800">
      <td className="px-4 py-2">{email}</td>
      <td className="px-4 py-2">
        {editable ? (
          <select
            defaultValue={role}
            onChange={(e) => changeRole(e.target.value)}
            className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
          >
            <option value="admin">{t('admin')}</option>
            <option value="member">{t('member')}</option>
            <option value="viewer">{t('viewer')}</option>
          </select>
        ) : (
          <span className="text-xs text-neutral-500">{t(role)}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        {editable && (
          <button
            onClick={remove}
            className="text-xs text-red-600 hover:underline"
          >
            {t('removeMember')}
          </button>
        )}
      </td>
    </tr>
  );
}
