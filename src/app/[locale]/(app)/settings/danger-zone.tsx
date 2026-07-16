'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';

// PR-SEC5 — Danger Zone with two-step account erase.
//
// Step 1: user clicks "계정 삭제" → confirm modal opens.
// Step 2: user types their own email exactly → POST /api/account/delete.
//
// The email re-entry is the same idiom GitHub / Stripe use for irreversible
// account ops. It's not a security control — the session cookie already
// proves identity — but it forces a deliberate keystroke and matches user
// expectations for a destructive action.

type Props = {
  email: string;
};

export function DangerZone({ email }: Props) {
  const t = useTranslations('Settings.danger');
  const tCommon = useTranslations('Common');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  function openConfirm() {
    setConfirmEmail('');
    setOpen(true);
  }

  function closeConfirm() {
    if (busy) return;
    setOpen(false);
  }

  async function handleDelete() {
    if (!matches || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.push(body?.error ?? t('deleteFailed'), { tone: 'warn' });
        setBusy(false);
        return;
      }

      // Auth row is gone; clear the local session before we redirect so
      // the landing page doesn't try to use a now-invalid sb-* cookie.
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});

      router.replace('/');
      router.refresh();
    } catch {
      toast.push(t('networkError'), { tone: 'warn' });
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 border border-warning bg-paper p-6 rounded-sm">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-warning">
        {t('zone')}
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em] text-ink-2">
        {t('deleteAccount')}
      </h2>
      <p className="mt-2 max-w-[640px] text-md leading-[1.7] text-mute">
        {t('description')}
      </p>
      <div className="mt-5">
        <Button variant="destructive" size="md" onClick={openConfirm}>
          {t('deleteCta')}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={closeConfirm}
        size="sm"
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeConfirm}
              disabled={busy}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!matches || busy}
              loading={busy}
              loadingLabel={t('deleting')}
            >
              {t('permanentDelete')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-md leading-[1.65] text-ink-2">
            {t.rich('emailReentry', {
              email,
              b: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
            })}
          </p>
          <Input
            type="email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={email}
            aria-label={t('confirmEmailLabel')}
            disabled={busy}
          />
        </div>
      </Modal>
    </section>
  );
}
