'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';

export function CreditsStatusBanner({ status }: { status: 'success' | 'cancelled' | null }) {
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
    router.replace(url.pathname + (url.search || ''), { scroll: false });
    // Auto-dismiss after 6 s for the success case.
    if (status === 'success') {
      const id = window.setTimeout(() => setVisible(false), 6000);
      return () => window.clearTimeout(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible || status == null) return null;

  const isSuccess = status === 'success';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 flex items-center justify-between gap-4 border px-4 py-3 text-[12.5px] [border-radius:4px] ${
        isSuccess
          ? 'border-amore/30 bg-amore/5 text-amore'
          : 'border-line bg-paper text-mute'
      }`}
    >
      <span>{isSuccess ? t('paymentSuccess') : t('paymentCancelled')}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="shrink-0 text-[16px] leading-none opacity-50 hover:opacity-100"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>
  );
}
