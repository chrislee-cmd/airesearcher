'use client';

import { useTranslations } from 'next-intl';
import { MochiLoader } from '@/components/ui/mochi-loader';
import './loading.css';

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
  // data-loading: layout 의 main 이 has-[[data-loading]]:p-0 으로 패딩을
  // 죽여 pop bg (노랑 + dot grid) 가 topbar 바로 아래 edge-to-edge 로
  // 깔린다. min-h-full 로 main 영역 전체를 채워 캔버스 등 직전 페이지의
  // 톤이 모서리에 비치는 것을 막는다.
  return (
    <div
      data-loading
      className="loading-pop flex min-h-full flex-col items-center justify-center"
    >
      <div className="loading-pop-card">
        <MochiLoader size={56} />
        <span className="loading-pop-label">{t('loading')}</span>
      </div>
    </div>
  );
}
