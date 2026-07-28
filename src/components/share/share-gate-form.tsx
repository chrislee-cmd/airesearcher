'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// 공개 공유 셸(B3d gated)의 게이트 폼 — ShareShell 이 그린 chrome(아이콘·헤드라인·
// privacy note) 안 form slot 에 children 으로 주입되는 client 조각.
//
// 보안(보수적): CD comp 는 단일 "Continue" 필드지만, 공개 페이지의 allow-list 는
// 방문자가 초대 이메일의 소유자임을 증명해야 한다 → 기존 OTP 2-step 흐름
// (/api/share/viewer/otp → verify)을 그대로 유지한다(누구나 초대 이메일을
// 타이핑해 통과하는 것을 막음). 인라인 에러는 필드 아래(§1 — 새 화면 금지).
//
// 기존 ShareEmailGate(구 /share/[token] 라우트)와 로직 동형 — 여기선 셸 chrome
// 이 헤더/카피를 소유하므로 폼 컨트롤만 렌더한다(중복 chrome 없음).

type Step = 'email' | 'code';

const RESEND_COOLDOWN_SEC = 60;

type SendResult =
  | { status: 'ok' }
  | { status: 'throttled'; retryAfter: number }
  | { status: 'error' };

export function ShareGateForm({
  token,
  prefillEmail,
  notInvited,
}: {
  token: string;
  prefillEmail?: string;
  /** 로그인 세션 이메일이 초대 목록에 없어 게이트로 떨어진 경우. */
  notInvited?: boolean;
}) {
  const t = useTranslations('Share.shell');
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendOtp = useCallback(
    async (value: string): Promise<SendResult> => {
      const res = await fetch('/api/share/viewer/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await sendOtp(value);
      if (result.status === 'throttled') {
        setCooldown(result.retryAfter);
        setError(t('gateThrottled'));
        return;
      }
      if (result.status === 'error') {
        setError(t('gateError'));
        return;
      }
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
        setError(t('gateThrottled'));
        return;
      }
      if (result.status === 'error') {
        setError(t('gateError'));
        return;
      }
      setCooldown(RESEND_COOLDOWN_SEC);
    });
  }

  function verifyCode(e: React.FormEvent) {
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
        setError(t('gateError'));
        return;
      }
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      // 미초대는 여기서만 드러난다(enumeration 보호) — §1 인라인 에러.
      setError(
        data?.error === 'not_invited'
          ? t('gateNotOnList')
          : t('gateInvalidCode'),
      );
    });
  }

  if (step === 'email') {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-2.5 text-left">
        <Input
          type="email"
          name="email"
          autoComplete="email"
          required
          fullWidth
          aria-label={t('gateEmailLabel')}
          placeholder={t('gateEmailPlaceholder')}
          value={email}
          error={error ?? undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {notInvited && !error && (
          <p className="text-xs text-mute">{t('gateSessionNotInvited')}</p>
        )}
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={pending}
          loadingLabel={t('gateSending')}
        >
          {t('gateContinue')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-2.5 text-left">
      <Input
        type="text"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        fullWidth
        aria-label={t('gateCodeLabel')}
        placeholder={t('gateCodePlaceholder')}
        helper={t('gateCodeHelper', { email: email.trim() })}
        value={code}
        error={error ?? undefined}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        fullWidth
        loading={pending}
        loadingLabel={t('gateVerifying')}
      >
        {t('gateVerify')}
      </Button>
      <Button
        type="button"
        variant="link"
        fullWidth
        disabled={cooldown > 0 || pending}
        onClick={resendCode}
      >
        {cooldown > 0
          ? t('gateResendCountdown', { seconds: cooldown })
          : t('gateResend')}
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
        {t('gateChangeEmail')}
      </Button>
    </form>
  );
}
