'use client';

import { useTranslations } from 'next-intl';
import { MochiLoader } from '@/components/ui/mochi-loader';

// Loading.tsx is rendered as a Suspense fallback. Next.js does not pass
// `params` to it, so there's no locale to feed into `setRequestLocale`.
// When this file was an async server component calling `getTranslations`
// (introduced in #161), next-intl resolved the default locale (`en`) and
// pinned that value in the request-scoped store — every subsequent
// `getTranslations` call in the (app) route group then rendered English
// even on /ko/* URLs.
//
// Fix: render the loader as a client component. `useTranslations` reads
// from the NextIntlClientProvider context (initialized in
// [locale]/layout.tsx with the URL's locale), so the loader still shows
// localized text without touching server request scope.
export default function Loading() {
  const t = useTranslations('Common');
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <MochiLoader size={64} label={t('loading')} />
    </div>
  );
}
