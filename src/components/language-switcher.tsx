'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function change(next: string) {
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
      {(['ko', 'en'] as const).map((lng, i) => (
        <span key={lng} className="flex items-center gap-2">
          <button
            onClick={() => change(lng)}
            disabled={isPending}
            className={`transition-colors duration-[120ms] ${
              lng === locale
                ? 'text-amore'
                : 'text-mute-soft hover:text-ink-2'
            }`}
          >
            {lng === 'ko' ? 'KO' : 'EN'}
          </button>
          {i === 0 && <span className="h-3 w-px bg-line" />}
        </span>
      ))}
    </div>
  );
}
