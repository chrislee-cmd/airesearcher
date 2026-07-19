import type { Metadata } from 'next';
import '../globals.css';

// Public capture page for remote AI-UT participants (624). Lives at the top
// level (outside `[locale]`) so it bypasses next-intl middleware, the `(app)`
// provider stack, and any auth redirect — anyone with the participant link
// can open it without signing in. This mirrors the `/live` interpretation
// viewer. Locale is negotiated server-side per request in the page and the
// participant UI is wrapped in its own NextIntlClientProvider there.
//
// 🔒 outward-facing (participant share link): no search-engine indexing/cache.

export const metadata: Metadata = {
  title: 'Research-Canvas — Session',
  description: 'Remote usability test session.',
  robots: { index: false, follow: false, nocache: true },
};

export default function UtParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
