'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { routing } from '@/i18n/routing';
import {
  persistLocalePreference,
  markLocaleSuggestDismissed,
} from '@/lib/i18n/locale-preference';
import { Button } from './ui/button';

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
    // An explicit choice: (1) stop nudging with the locale-suggest banner,
    // (2) remember it in the DB for logged-in users so other devices pick it
    // up (best-effort; 401 for logged-out is ignored). The NEXT_LOCALE cookie
    // that persists the choice for THIS browser is set by next-intl's router
    // below.
    markLocaleSuggestDismissed();
    void persistLocalePreference(next);
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]">
      {routing.locales.map((lng, i) => (
        <span key={lng} className="flex items-center gap-2">
          <Button
            variant="link"
            size="xs"
            onClick={() => change(lng)}
            disabled={isPending}
            className={`!px-0 !py-0 !text-xs !font-semibold uppercase tracking-[0.18em] ${
              lng === locale
                ? '!text-amore'
                : '!text-mute-soft hover:!text-ink-2'
            }`}
          >
            {LOCALE_LABEL[lng] ?? lng.toUpperCase()}
          </Button>
          {i < routing.locales.length - 1 && (
            <span className="h-3 w-px bg-line" />
          )}
        </span>
      ))}
    </div>
  );
}
