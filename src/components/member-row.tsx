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
    <tr className="border-t border-line-soft">
      <td className="px-5 py-3 text-ink-2">{email}</td>
      <td className="px-5 py-3">
        {editable ? (
          <select
            defaultValue={role}
            onChange={(e) => changeRole(e.target.value)}
            className="border border-line bg-paper px-2 py-1 text-[11.5px] text-ink-2 [border-radius:4px]"
          >
            <option value="admin">{t('admin')}</option>
            <option value="member">{t('member')}</option>
            <option value="viewer">{t('viewer')}</option>
          </select>
        ) : (
          <span className="text-[11px] uppercase tracking-[0.18em] text-mute-soft">
            {t(role)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {editable && (
          <button
            onClick={remove}
            className="text-[11px] uppercase tracking-[0.18em] text-mute hover:text-warning"
          >
            {t('removeMember')}
          </button>
        )}
      </td>
    </tr>
  );
}
