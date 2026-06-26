'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const OUTFIT_STACK = 'var(--font-outfit), var(--font-sans)';

// Memphis chrome reused across email input / role select. 2.5px border +
// xs offset shadow keeps editorial weight consistent with the surrounding
// PR-D5 shell tokens.
const MEMPHIS_FIELD_STYLE = {
  border: 'var(--sidebar-nav-border-width) solid var(--sidebar-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  background: 'var(--sidebar-nav-bg)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

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

  const labelStyle = {
    fontFamily: OUTFIT_STACK,
    fontWeight: 800,
    color: 'var(--sidebar-border)',
  } as const;

  // <select> kept as native — react/forbid-elements only blocks
  // button/input/textarea. Same Memphis chrome via shared style.
  const selectCls =
    'mt-1.5 px-3 py-2 pr-7 text-md text-ink focus:outline-none';

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <label
          className="text-xs uppercase tracking-[0.22em]"
          style={labelStyle}
        >
          {t('email')}
        </label>
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          size="sm"
          className="!mt-1.5 !border-0 !px-3 !py-2 !text-md !text-ink rounded-[var(--sidebar-nav-radius)] focus-visible:!border-0"
          style={MEMPHIS_FIELD_STYLE}
        />
      </div>
      <div>
        <label
          className="text-xs uppercase tracking-[0.22em]"
          style={labelStyle}
        >
          {t('role')}
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          className={selectCls}
          style={MEMPHIS_FIELD_STYLE}
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
        className="!border-0 uppercase tracking-[0.22em] transition-transform duration-[120ms] hover:-translate-y-0.5 disabled:!opacity-60"
        style={{
          fontFamily: OUTFIT_STACK,
          fontWeight: 800,
          background: 'var(--sidebar-active-bg)',
          color: 'var(--sidebar-active-text)',
          border: 'var(--sidebar-border-width) solid var(--sidebar-border)',
          borderRadius: 'var(--sidebar-nav-radius)',
          boxShadow: 'var(--memphis-shadow-sm)',
        }}
      >
        {busy ? tCommon('loading') : t('invite')}
      </Button>
    </form>
  );
}
