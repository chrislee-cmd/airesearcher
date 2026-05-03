'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

export function InviteMemberForm({ orgId }: { orgId: string }) {
  const t = useTranslations('Members');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/members/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, email, role }),
    });
    setBusy(false);
    if (res.ok) {
      setEmail('');
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs text-neutral-500">{t('email')}</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">{t('role')}</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className="mt-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        >
          <option value="admin">{t('admin')}</option>
          <option value="member">{t('member')}</option>
          <option value="viewer">{t('viewer')}</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      >
        {busy ? tCommon('loading') : t('invite')}
      </button>
    </form>
  );
}
