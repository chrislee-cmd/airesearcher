import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko', 'en'],
  // English as the catch-all default: any user whose Accept-Language doesn't
  // match `ko` or `en` (e.g. ja/zh/fr with no English fallback, or empty
  // header from bots) lands on /en instead of /ko. Korean speakers still
  // match `ko-*` explicitly, so /ko traffic is unaffected.
  defaultLocale: 'en',
  localePrefix: 'always',
});
