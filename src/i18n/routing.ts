import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko', 'en', 'ja'],
  // English as the catch-all default: any user whose Accept-Language doesn't
  // match an explicitly-supported locale lands on /en instead of /ko.
  // Japanese (`ja-*`) and Korean (`ko-*`) speakers match their own locale;
  // every other language falls through to English.
  defaultLocale: 'en',
  localePrefix: 'always',
});
