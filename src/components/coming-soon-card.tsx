'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { FeatureKey } from '@/lib/features';
import { useToast } from './toast-provider';

type Props = {
  feature: FeatureKey;
};

// Renders the "coming soon" body for unfinished generators. Pops a toast on
// first mount so the route change feels acknowledged even before the body
// paints. Idempotent across re-renders thanks to a mount ref.
export function ComingSoonCard({ feature }: Props) {
  const t = useTranslations('ComingSoon');
  const tSidebar = useTranslations('Sidebar');
  const toast = useToast();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    toast.push(t('toast'), { tone: 'amore' });
  }, [toast, t]);

  return (
    <div className="mx-auto max-w-[520px] border border-line bg-paper p-7 [border-radius:4px]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
        {t('eyebrow')}
      </p>
      <h1 className="mt-2 text-[20px] font-bold tracking-[-0.018em] text-ink-2">
        {tSidebar(feature)}
      </h1>
      <p className="mt-3 text-[13px] leading-[1.7] text-mute">{t('body')}</p>
    </div>
  );
}
