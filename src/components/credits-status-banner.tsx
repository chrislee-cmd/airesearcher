'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { IconButton } from './ui/icon-button';

export function CreditsStatusBanner({
  status,
}: {
  status: 'success' | 'cancelled' | 'subscribed' | null;
}) {
  const t = useTranslations('Credits');
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(status != null);

  useEffect(() => {
    if (!visible) return;
    // Strip ?status= from the URL without triggering a navigation.
    const url = new URL(window.location.href);
    url.searchParams.delete('status');
    url.searchParams.delete('payment_id');
    url.searchParams.delete('tier');
    router.replace(url.pathname + (url.search || ''), { scroll: false });
    // Auto-dismiss after 6 s for the success / subscribed cases.
    if (status === 'success' || status === 'subscribed') {
      const id = window.setTimeout(() => setVisible(false), 6000);
      return () => window.clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible || status == null) return null;

  const isSuccess = status === 'success' || status === 'subscribed';
  const message =
    status === 'subscribed'
      ? t('subscribeSuccess')
      : status === 'success'
      ? t('paymentSuccess')
      : t('paymentCancelled');

  // PR-D17 pop 톤: 3px black border + 4px offset shadow. 성공=노랑 wash,
  // 취소=흰 paper. Outfit display 로 한 줄 강조.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: isSuccess ? 'var(--canvas-bg)' : '#fff',
        border: '3px solid var(--canvas-card-border)',
        borderRadius: 'var(--canvas-card-radius)',
        boxShadow: '4px 4px 0 var(--canvas-card-border)',
        fontFamily: 'var(--font-outfit), var(--font-sans)',
      }}
      className="mb-4 flex items-center justify-between gap-4 px-4 py-3 text-md rounded-sm"
    >
      <span className="font-bold text-ink-2">{message}</span>
      <IconButton
        variant="ghost"
        onClick={() => setVisible(false)}
        className="shrink-0 !border-0 text-2xl leading-none text-ink-2 opacity-70 hover:opacity-100"
        aria-label="dismiss"
      >
        ×
      </IconButton>
    </div>
  );
}
