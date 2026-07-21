'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// 공유 뷰어 전화번호 뒷자리 진입 게이트 (클라이언트).
//
// 1-스텝: 초대된 참석자가 전화번호 뒷자리(4자리)를 입력 → 서버가 token 스코프
// 안에서 attendee 를 도출하고 통과 시 서명 쿠키를 심는다 → router.refresh()
// 로 페이지가 read-only 렌더로 다시 그려진다.
//
// 🔒 데이터 노출 0: 이 컴포넌트는 리소스를 전혀 받지 않는다. 무효 토큰/무매칭/
// 뒷자리 충돌은 서버가 모두 동일한 generic 오류로 응답(enumeration 방지) —
// 클라이언트는 "일치하는 참석자를 찾지 못함" 이상을 알 수 없다.

const LAST4_LEN = 4;

type SubmitResult =
  | { status: 'ok' }
  | { status: 'throttled'; retryAfter: number }
  | { status: 'invalid' }
  | { status: 'error' };

export function SharePhoneGate({ token }: { token: string }) {
  const t = useTranslations('ShareViewer');
  const router = useRouter();
  const [last4, setLast4] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(value: string): Promise<SubmitResult> {
    const res = await fetch('/api/share/viewer/phone-gate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, last4: value }),
    }).catch(() => null);
    if (!res) return { status: 'error' };
    if (res.ok) return { status: 'ok' };
    if (res.status === 429) {
      const data = (await res.json().catch(() => null)) as {
        retry_after?: number;
      } | null;
      return { status: 'throttled', retryAfter: data?.retry_after ?? 0 };
    }
    if (res.status === 401) return { status: 'invalid' };
    return { status: 'error' };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // 숫자만 남겨 마지막 4자리를 뒷자리로. (서버도 동일하게 정규화하지만
    // 클라에서 미리 걸러 400 을 줄인다.)
    const digits = last4.replace(/\D/g, '');
    if (digits.length < LAST4_LEN) {
      setError(t('phoneGateErrorFormat'));
      return;
    }
    startTransition(async () => {
      const result = await submit(digits);
      if (result.status === 'ok') {
        router.refresh();
        return;
      }
      if (result.status === 'throttled') {
        setError(t('phoneGateErrorThrottled'));
        return;
      }
      if (result.status === 'invalid') {
        setError(t('phoneGateErrorNoMatch'));
        return;
      }
      setError(t('errorGeneric'));
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
            {t('phoneGateTitle')}
          </h1>
          <p className="mt-2 text-md leading-[1.7] text-mute">
            {t('phoneGateSubtitle')}
          </p>
        </header>

        <div className="border border-line bg-paper p-6 rounded-sm">
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              type="text"
              name="last4"
              inputMode="numeric"
              autoComplete="off"
              maxLength={LAST4_LEN}
              required
              fullWidth
              label={t('phoneGateLabel')}
              placeholder={t('phoneGatePlaceholder')}
              helper={t('phoneGateHelper')}
              value={last4}
              onChange={(e) => setLast4(e.target.value)}
            />
            {error && <p className="text-sm text-amore">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={pending}
              loadingLabel={t('verifying')}
            >
              {t('phoneGateSubmit')}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
