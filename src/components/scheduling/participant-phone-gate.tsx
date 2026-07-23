'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PHONE_TAIL_LEN } from '@/lib/scheduling/participant-gate';

// Participant entry gate for the recruiting-scheduling COMMON share link,
// redesigned to the Memphis system (CD frame 03B "Verify it's you"). The link
// is anonymous (one URL per project), so the visitor proves identity with the
// last PHONE_TAIL_LEN digits of the phone the admin registered. The verify
// route matches the tail against the project's candidates:
//   * unique match → sets the candidate-bound cookie → we refresh into the view;
//   * collision (same tail, distinct names) → we show a name picker;
//   * collision with indistinguishable names → we ask for the full phone number;
//   * no match / wrong digits → an inline error on the OTP cells.
// Presentation is a fresh Memphis build (CD SSOT); only the verify flow logic is
// reused. All surfaces bind to design tokens (§9) — no hardcoded hex, no
// arbitrary shadows/radii (shadow-memphis-* / rounded-{xs,sm,md,full} only).

// Display font stacks: Outfit 800 for the screen title (CD 03B), ui-monospace
// for the OTP digits. Consumed inline (same pattern as WidgetFullviewPanel) —
// this route defines --font-outfit in schedule/layout.tsx.
const OUTFIT = 'var(--font-outfit), var(--font-sans)';
const MONO = 'ui-monospace, Menlo, monospace';

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
  const [focused, setFocused] = useState(false);

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
    <GateCanvas>
      {step === 'pick' ? (
        <>
          <GateHeader
            title={t('collisionTitle')}
            body={t('collisionBody')}
          />
          <div className="flex w-full flex-col gap-2">
            {picks.map((c) => (
              <Button
                key={c.id}
                variant="secondary"
                fullWidth
                size="lg"
                className="!rounded-full"
                onClick={() => void post({ tail, candidateId: c.id })}
                disabled={submitting}
              >
                {c.name?.trim() || t('collisionUnnamed')}
              </Button>
            ))}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </>
      ) : step === 'fullphone' ? (
        <>
          <GateHeader
            title={t('fullPhoneTitle')}
            body={t('fullPhoneBody')}
          />
          <div className="flex w-full flex-col gap-3">
            <Input
              label={t('fullPhoneLabel')}
              inputMode="tel"
              autoComplete="off"
              value={fullPhone}
              error={error ?? undefined}
              className="!border-2 !border-ink text-ink"
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
              size="lg"
              className="!rounded-full"
              onClick={() => void post({ fullPhone })}
              disabled={!canSubmitFull}
            >
              {submitting ? t('gateVerifying') : t('gateSubmit')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <LockChip />
          <h1
            className="mt-1.5 text-center text-ink"
            style={{ fontFamily: OUTFIT, fontWeight: 800, fontSize: 22, letterSpacing: '-0.4px' }}
          >
            {t('gateTitle')}
          </h1>
          <p className="max-w-[340px] text-center text-lg leading-relaxed text-mute">
            {t('gateBody', { n: PHONE_TAIL_LEN })}
          </p>

          {/* 6-cell OTP — one visually-hidden, focusable <Input> captures the
              digits; the 6 cells are presentation only. Clicking the row (the
              wrapping <label>) focuses the input; the active cell tracks the
              caret position while focused. */}
          <label className="relative mt-4 flex cursor-text gap-[9px]">
            {Array.from({ length: PHONE_TAIL_LEN }).map((_, i) => {
              const filled = i < tail.length;
              const active = focused && i === Math.min(tail.length, PHONE_TAIL_LEN - 1);
              const cellTone = error
                ? 'border-warning bg-paper'
                : filled
                  ? 'border-ink bg-paper shadow-memphis-sm-faint'
                  : active
                    ? 'border-amore bg-paper shadow-memphis-xs-amore'
                    : 'border-ink/20 bg-paper-soft';
              return (
                <span
                  key={i}
                  className={`flex h-14 w-[46px] items-center justify-center rounded-sm border-2 text-ink ${cellTone}`}
                  style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22 }}
                >
                  {tail[i] ?? ''}
                </span>
              );
            })}
            <Input
              fullWidth={false}
              className="sr-only"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={t('gateInputLabel', { n: PHONE_TAIL_LEN })}
              maxLength={PHONE_TAIL_LEN}
              autoFocus
              value={tail}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
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
          </label>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button
            variant="primary"
            fullWidth
            size="lg"
            className="mt-[22px] !rounded-full"
            onClick={() => void post({ tail })}
            disabled={!canSubmitTail}
          >
            {submitting ? t('gateVerifying') : t('gateSubmit')}
          </Button>

          <p className="mt-2.5 flex items-start justify-center gap-[7px] text-center text-sm leading-snug text-mute-soft">
            <span aria-hidden="true">🛈</span>
            <span>{t('gatePrivacy')}</span>
          </p>
        </>
      )}
    </GateCanvas>
  );
}

// Centered Memphis card on the neutral canvas (CD 03B). The 520×620 device
// frame in the comp is mockup chrome; the real page centers the card on the
// viewport and lets it fill small screens.
function GateCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 py-10">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-2 rounded-md border-[3px] border-ink bg-paper px-[30px] py-[34px] shadow-memphis-2xl">
        {children}
      </div>
    </div>
  );
}

// Sky icon chip (CD 03B) — the participant identity tone.
function LockChip() {
  return (
    <span
      aria-hidden="true"
      className="flex h-[60px] w-[60px] items-center justify-center rounded-sm border-2 border-ink bg-sky shadow-memphis-sm"
      style={{ fontSize: 28 }}
    >
      🔒
    </span>
  );
}

function GateHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1
        className="text-ink"
        style={{ fontFamily: OUTFIT, fontWeight: 800, fontSize: 22, letterSpacing: '-0.4px' }}
      >
        {title}
      </h1>
      <p className="text-lg leading-relaxed text-mute">{body}</p>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-warning">{children}</p>;
}
