'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { routing } from '@/i18n/routing';

// Short uppercase label shown in the switcher. Falls back to the locale
// code uppercased so adding a new locale to `routing.locales` Just Works
// without touching this file — labels here are only for prettifying the
// common ones.
const LOCALE_LABEL: Record<string, string> = {
  ko: 'KO',
  en: 'EN',
  ja: 'JA',
  th: 'TH',
};

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
      {routing.locales.map((lng, i) => (
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
            {LOCALE_LABEL[lng] ?? lng.toUpperCase()}
          </button>
          {i < routing.locales.length - 1 && (
            <span className="h-3 w-px bg-line" />
          )}
        </span>
      ))}
    </div>
  );
}
