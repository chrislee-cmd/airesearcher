'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// 공유 뷰어 이메일 인증 게이트 (클라이언트).
//
// 2-스텝: (1) 초대된 이메일 입력 → OTP 발송, (2) 코드 입력 → 검증. 검증이
// 서버(assertInvitedViewer)를 통과하면 서명 쿠키가 심기고 router.refresh()
// 로 페이지가 read-only 렌더로 다시 그려진다.
//
// 🔒 데이터 노출 0: 이 컴포넌트는 리소스를 전혀 받지 않는다. 미초대 이메일도
// OTP 발송 응답은 동일(enumeration 방지) — 실제 거부는 코드 검증 단계에서만
// "초대되지 않음"으로 드러난다.

type Step = 'email' | 'code';

// 재전송 쿨다운(초). 스팸 클릭이 Supabase 이메일 캡을 소진하는 악순환을
// 막는다 — 서버 rate limit(share-otp)의 클라이언트 측 짝. 서버가 429 로
// 더 긴 대기를 요구하면 그 retryAfter 로 덮어쓴다.
const RESEND_COOLDOWN_SEC = 60;

type SendResult =
  | { status: 'ok' }
  | { status: 'throttled'; retryAfter: number }
  | { status: 'error' };

export function ShareEmailGate({
  token,
  prefillEmail,
  notInvited,
}: {
  token: string;
  prefillEmail?: string;
  /** 로그인 세션 이메일이 초대 목록에 없어 게이트로 떨어진 경우. */
  notInvited?: boolean;
}) {
  const t = useTranslations('ShareViewer');
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();

  // 쿨다운 카운트다운. cooldown > 0 인 동안 매초 1씩 감소.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // OTP 발송 요청. 응답은 초대 여부와 무관하게 동일하므로(enumeration 보호)
  // 여기서 구분하는 신호는 오직 요청자 본인의 rate limit(429)뿐이다.
  const sendOtp = useCallback(
    async (value: string): Promise<SendResult> => {
      const res = await fetch('/api/share/viewer/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // locale: 매직링크가 남더라도 앱 루트가 아닌 이 공유 페이지로
        // 리다이렉트되도록 서버가 emailRedirectTo 를 구성하는 데 쓴다.
        body: JSON.stringify({ token, email: value, locale }),
      }).catch(() => null);
      if (!res) return { status: 'error' };
      if (res.status === 429) {
        const data = (await res.json().catch(() => null)) as {
          retry_after?: number;
        } | null;
        return {
          status: 'throttled',
          retryAfter: data?.retry_after ?? RESEND_COOLDOWN_SEC,
        };
      }
      if (!res.ok) return { status: 'error' };
      return { status: 'ok' };
    },
    [token, locale],
  );

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await sendOtp(value);
      if (result.status === 'throttled') {
        setCooldown(result.retryAfter);
        setError(t('errorThrottled'));
        return;
      }
      if (result.status === 'error') {
        setError(t('errorGeneric'));
        return;
      }
      // 초대 여부와 무관하게 코드 단계로 — 응답으로 초대 여부를 노출하지 않음.
      setCooldown(RESEND_COOLDOWN_SEC);
      setStep('code');
    });
  }

  function resendCode() {
    if (cooldown > 0 || pending) return;
    const value = email.trim();
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const result = await sendOtp(value);
      if (result.status === 'throttled') {
        setCooldown(result.retryAfter);
        setError(t('errorThrottled'));
        return;
      }
      if (result.status === 'error') {
        setError(t('errorGeneric'));
        return;
      }
      setCooldown(RESEND_COOLDOWN_SEC);
    });
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = code.trim();
    if (!value) return;
    startTransition(async () => {
      const res = await fetch('/api/share/viewer/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim(), code: value }),
      }).catch(() => null);
      if (!res) {
        setError(t('errorGeneric'));
        return;
      }
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(
        data?.error === 'not_invited'
          ? t('notInvitedBody')
          : t('errorInvalidCode'),
      );
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px]">
        <header className="mb-6 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-mute-soft">
            {t('eyebrow')}
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.01em] text-ink">
            {t('gateTitle')}
          </h1>
          <p className="mt-2 text-md leading-[1.7] text-mute">
            {step === 'email' ? t('gateSubtitle') : t('gateCodeSubtitle')}
          </p>
          {notInvited && step === 'email' && (
            <p className="mt-2 text-sm text-mute">{t('gateSessionNotInvited')}</p>
          )}
        </header>

        <div className="border border-line bg-paper p-6 rounded-sm">
          {step === 'email' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <Input
                type="email"
                name="email"
                autoComplete="email"
                required
                fullWidth
                label={t('emailLabel')}
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="text-sm text-amore">{error}</p>}
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={pending}
                loadingLabel={t('sending')}
              >
                {t('sendCode')}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <Input
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                fullWidth
                label={t('codeLabel')}
                placeholder={t('codePlaceholder')}
                helper={t('codeHelper', { email: email.trim() })}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {error && <p className="text-sm text-amore">{error}</p>}
              <p className="text-sm leading-[1.7] text-mute">
                {t('resendHint')}
              </p>
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={pending}
                loadingLabel={t('verifying')}
              >
                {t('verify')}
              </Button>
              <Button
                type="button"
                variant="link"
                fullWidth
                disabled={cooldown > 0 || pending}
                onClick={resendCode}
              >
                {cooldown > 0
                  ? t('resendCountdown', { seconds: cooldown })
                  : t('resend')}
              </Button>
              <Button
                type="button"
                variant="link"
                fullWidth
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                  setCooldown(0);
                }}
              >
                {t('changeEmail')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
