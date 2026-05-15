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

  const labelCls =
    'text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft';
  const inputCls =
    'mt-1 border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 focus:border-amore focus:outline-none [border-radius:14px]';

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <label className={labelCls}>{t('email')}</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputCls} w-full`}
        />
      </div>
      <div>
        <label className={labelCls}>{t('role')}</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className={`${inputCls} pr-7`}
        >
          <option value="admin">{t('admin')}</option>
          <option value="member">{t('member')}</option>
          <option value="viewer">{t('viewer')}</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="border border-ink bg-ink px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:opacity-60 [border-radius:14px]"
      >
        {busy ? tCommon('loading') : t('invite')}
      </button>
    </form>
  );
}
