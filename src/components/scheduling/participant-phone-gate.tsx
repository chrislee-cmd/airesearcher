'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PHONE_TAIL_LEN } from '@/lib/scheduling/participant-gate';

// Entry gate for the recruiting-scheduling COMMON share link. The link is
// anonymous (one URL per project), so the visitor proves identity with the last
// PHONE_TAIL_LEN digits of the phone the admin registered. The verify route
// matches the tail against the project's candidates:
//   * unique match → sets the candidate-bound cookie → we refresh into the view;
//   * collision (same tail, distinct names) → we show a name picker;
//   * collision with indistinguishable names → we ask for the full phone number;
//   * no match → a plain "no candidate" message (no-phone candidates never
//     match, so they land here too — consistent with the no-phone policy).
// All UI uses design tokens (§9); no login, no navigation chrome.

// Display only: group the 6 raw digits as ##-#### (hyphen after the 2nd). The
// stored `tail` state stays digits-only, so the value POSTed to /verify never
// carries the hyphen (and `normalizeTailInput` strips it server-side anyway).
function formatTail(digits: string): string {
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

type PickCandidate = { id: string; name: string | null };
type Step = 'tail' | 'pick' | 'fullphone';

export function ParticipantPhoneGate({ token }: { token: string }) {
  const t = useTranslations('SchedulingParticipant');
  const router = useRouter();
  const [step, setStep] = useState<Step>('tail');
  const [tail, setTail] = useState('');
  const [fullPhone, setFullPhone] = useState('');
  const [picks, setPicks] = useState<PickCandidate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyUrl = `/api/scheduling/public/${encodeURIComponent(token)}/verify`;

  // Map a failed response to a user message. no_match (404) is a distinct,
  // non-generic message per the redesign spec ("일치하는 후보 없음").
  function messageForFailure(status: number): string {
    if (status === 429) return t('gateRateLimited');
    if (status === 404) return t('gateNoMatch');
    return t('gateError');
  }

  // Send a verify request and route the response into the next step.
  async function post(payload: Record<string, unknown>) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          collision?: boolean;
          needFullPhone?: boolean;
          candidates?: PickCandidate[];
        };
        if (json.ok) {
          router.refresh(); // cookie set → server page renders the schedule
          return;
        }
        if (json.collision && json.needFullPhone) {
          setStep('fullphone');
          return;
        }
        if (json.collision && Array.isArray(json.candidates)) {
          setPicks(json.candidates);
          setStep('pick');
          return;
        }
        setError(t('gateError'));
        return;
      }
      setError(messageForFailure(res.status));
    } catch {
      setError(t('gateError'));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmitTail = tail.length === PHONE_TAIL_LEN && !submitting;
  const canSubmitFull = fullPhone.replace(/\D/g, '').length >= 8 && !submitting;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6">
      {step === 'pick' ? (
        <>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-lg font-semibold text-ink">
              {t('collisionTitle')}
            </h1>
            <p className="text-sm text-mute">{t('collisionBody')}</p>
          </div>
          <div className="flex w-full flex-col gap-2">
            {picks.map((c) => (
              <Button
                key={c.id}
                variant="secondary"
                fullWidth
                onClick={() => void post({ tail, candidateId: c.id })}
                disabled={submitting}
                className="min-h-11"
              >
                {c.name?.trim() || t('collisionUnnamed')}
              </Button>
            ))}
            {error && <p className="text-sm text-warning">{error}</p>}
          </div>
        </>
      ) : step === 'fullphone' ? (
        <>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-lg font-semibold text-ink">
              {t('fullPhoneTitle')}
            </h1>
            <p className="text-sm text-mute">{t('fullPhoneBody')}</p>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Input
              label={t('fullPhoneLabel')}
              inputMode="tel"
              autoComplete="off"
              value={fullPhone}
              error={error ?? undefined}
              onChange={(e) => setFullPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canSubmitFull) void post({ fullPhone });
                }
              }}
            />
            <Button
              variant="primary"
              fullWidth
              onClick={() => void post({ fullPhone })}
              disabled={!canSubmitFull}
              className="min-h-11"
            >
              {submitting ? t('gateVerifying') : t('gateSubmit')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-lg font-semibold text-ink">{t('gateTitle')}</h1>
            <p className="text-sm text-mute">
              {t('gateBody', { n: PHONE_TAIL_LEN })}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3">
            <Input
              label={t('gateInputLabel', { n: PHONE_TAIL_LEN })}
              inputMode="numeric"
              autoComplete="off"
              // +1 for the display hyphen (##-####); the stored value is 6 digits.
              maxLength={PHONE_TAIL_LEN + 1}
              placeholder="##-####"
              value={formatTail(tail)}
              error={error ?? undefined}
              onChange={(e) =>
                setTail(e.target.value.replace(/\D/g, '').slice(0, PHONE_TAIL_LEN))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canSubmitTail) void post({ tail });
                }
              }}
            />
            <Button
              variant="primary"
              fullWidth
              onClick={() => void post({ tail })}
              disabled={!canSubmitTail}
              className="min-h-11"
            >
              {submitting ? t('gateVerifying') : t('gateSubmit')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
