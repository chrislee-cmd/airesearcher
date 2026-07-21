'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PHONE_TAIL_LEN } from '@/lib/scheduling/participant-gate';

// Entry gate for the recruiting-scheduling share link. Before the participant
// can see their own schedule/chat they must prove identity with the last
// PHONE_TAIL_LEN digits of the phone the admin registered. On success the verify
// route sets a token-bound httpOnly cookie; we then refresh so the (server) page
// re-resolves the gate and renders <ParticipantSchedule>. Deliberately generic:
// a wrong tail never reveals whether the candidate/phone exists. All UI uses
// design tokens (§9); no login, no navigation chrome.
export function ParticipantPhoneGate({ token }: { token: string }) {
  const t = useTranslations('SchedulingParticipant');
  const router = useRouter();
  const [tail, setTail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = tail.length === PHONE_TAIL_LEN && !submitting;

  async function submit() {
    if (tail.length !== PHONE_TAIL_LEN || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/scheduling/public/${encodeURIComponent(token)}/verify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tail }),
        },
      );
      if (res.ok) {
        // Cookie is set; re-render the server page (now passes the gate).
        router.refresh();
        return;
      }
      setError(res.status === 429 ? t('gateRateLimited') : t('gateError'));
    } catch {
      setError(t('gateError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-ink">{t('gateTitle')}</h1>
        <p className="text-sm text-mute">{t('gateBody', { n: PHONE_TAIL_LEN })}</p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Input
          label={t('gateInputLabel', { n: PHONE_TAIL_LEN })}
          inputMode="numeric"
          autoComplete="off"
          maxLength={PHONE_TAIL_LEN}
          placeholder={'•'.repeat(PHONE_TAIL_LEN)}
          value={tail}
          error={error ?? undefined}
          onChange={(e) =>
            setTail(e.target.value.replace(/\D/g, '').slice(0, PHONE_TAIL_LEN))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          variant="primary"
          fullWidth
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="min-h-11"
        >
          {submitting ? t('gateVerifying') : t('gateSubmit')}
        </Button>
      </div>
    </div>
  );
}
