import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko', 'en', 'ja', 'th'],
  // English is the global default for EVERY first-time visitor, regardless
  // of browser language (i18n Phase 1). We keep next-intl's localeDetection
  // ON so the NEXT_LOCALE cookie (an explicit switcher choice) still
  // persists across visits, but src/proxy.ts neutralizes the Accept-Language
  // header when no cookie is present — so ko-*/ja-*/th-* browsers land on
  // /en, not their own locale. Korean/Japanese/Thai speakers reach their
  // language only by an explicit choice (switcher, or the one-time
  // locale-suggest banner), never by automatic detection.
  defaultLocale: 'en',
  localePrefix: 'always',
});
