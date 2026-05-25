import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko', 'en', 'ja', 'th'],
  // English as the catch-all default: any user whose Accept-Language doesn't
  // match an explicitly-supported locale lands on /en instead of /ko.
  // Korean (`ko-*`), Japanese (`ja-*`), and Thai (`th-*`) speakers match
  // their own locale; every other language falls through to English.
  defaultLocale: 'en',
  localePrefix: 'always',
});
