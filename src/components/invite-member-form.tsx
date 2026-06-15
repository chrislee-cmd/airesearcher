'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  // <select> kept as native (not flagged by forbid-elements) — preserves the
  // inline editorial chrome alongside the migrated <Input>/<Button>.
  const selectCls =
    'mt-1 border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 focus:border-amore focus:outline-none rounded-sm pr-7';

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <label className={labelCls}>{t('email')}</label>
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          size="sm"
          className="!mt-1 !px-3 !text-[12.5px] !text-ink-2"
        />
      </div>
      <div>
        <label className={labelCls}>{t('role')}</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className={selectCls}
        >
          <option value="admin">{t('admin')}</option>
          <option value="member">{t('member')}</option>
          <option value="viewer">{t('viewer')}</option>
        </select>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={busy}
        className="!text-[11px] uppercase tracking-[0.22em] disabled:!opacity-60"
      >
        {busy ? tCommon('loading') : t('invite')}
      </Button>
    </form>
  );
}
