'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast-provider';

// Collaborator share for the recruiting-scheduling workspace. Invites a
// teammate by email as a full org member (role='member') — the invite reuses
// POST /api/members/invite, which now also sends the real invite email.
//
// Conservative scope (pr-recsched-collab-access): the app does not yet enforce
// a viewer/readonly tier, so NO role picker is shown — every invite is a full
// member. We also deliberately do NOT reuse <MemberRow> here (its role <select>
// exposes 'viewer', which the spec forbids surfacing); the collaborator list is
// a minimal email + remove list instead.

export type CollabMember = {
  userId: string | null;
  email: string;
  role: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CollabShareButton({
  orgId,
  members,
}: {
  orgId: string;
  members: CollabMember[];
}) {
  const t = useTranslations('CollabShare');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast.push(t('invalidEmail'), { tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/members/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, email: value, role: 'member', locale }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; email_sent?: boolean; error?: string }
        | null;
      if (res.status === 403) {
        toast.push(t('forbidden'), { tone: 'warn' });
        return;
      }
      if (!res.ok || !json?.ok) {
        toast.push(t('inviteError'), { tone: 'warn' });
        return;
      }
      // Row created; the email is best-effort — flag a partial success so the
      // inviter knows to follow up manually if delivery failed.
      toast.push(json.email_sent ? t('invited') : t('invitedNoEmail'), {
        tone: json.email_sent ? 'amore' : 'warn',
      });
      setEmail('');
      router.refresh();
    } catch {
      toast.push(t('inviteError'), { tone: 'warn' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: CollabMember) {
    if (!confirm(t('removeConfirm', { email: m.email }))) return;
    try {
      const res = await fetch('/api/members/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, user_id: m.userId, email: m.email }),
      });
      if (!res.ok) {
        toast.push(t('removeError'), { tone: 'warn' });
        return;
      }
      router.refresh();
    } catch {
      toast.push(t('removeError'), { tone: 'warn' });
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      {open ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          size="sm"
          labelledBy="collab-share-title"
        >
          <div className="flex flex-col gap-4 p-6">
            <div>
              <h2
                id="collab-share-title"
                className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
              >
                {t('title')}
              </h2>
              <p className="mt-1 text-sm text-mute">{t('notice')}</p>
            </div>

            <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <Input
                  type="email"
                  label={t('emailLabel')}
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={busy}
                loadingLabel={t('inviting')}
              >
                {t('invite')}
              </Button>
            </form>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                {t('collaboratorsLabel')}
              </span>
              {members.length === 0 ? (
                <p className="py-2 text-sm text-mute-soft">{t('empty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line-soft">
                  {members.map((m) => (
                    <li
                      key={m.userId ?? m.email}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {m.email}
                        {m.role === 'owner' ? (
                          <span className="ml-2 text-xs uppercase tracking-[0.16em] text-mute-soft">
                            {t('ownerTag')}
                          </span>
                        ) : m.userId ? null : (
                          <span className="ml-2 text-xs uppercase tracking-[0.16em] text-mute-soft">
                            {t('pendingTag')}
                          </span>
                        )}
                      </span>
                      {m.role !== 'owner' ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void remove(m)}
                        >
                          {t('remove')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-soft px-6 py-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('done')}
            </Button>
          </footer>
        </Modal>
      ) : null}
    </>
  );
}
