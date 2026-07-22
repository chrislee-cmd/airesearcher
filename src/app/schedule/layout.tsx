import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import '../globals.css';

// Outfit display font — the recruiting-scheduling redesign (Memphis, CD frames
// 03B·04) renders participant screen titles in Outfit 800. This route lives
// outside `(app)`, so its `--font-outfit` variable is defined here (mirrors
// `(app)/layout.tsx`); the participant components consume it via inline
// `fontFamily: 'var(--font-outfit), var(--font-sans)'` (same pattern as
// WidgetFullviewPanel).
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

// Public participant page for the recruiting-scheduling share link (PR4). Lives
// at the top level (outside `[locale]`) so it bypasses next-intl middleware,
// the `(app)` provider stack, and any auth redirect — anyone with the share
// link can open it without signing in. Mirrors `/ut-live` and `/live`. Locale
// is negotiated server-side per request in the page and the participant UI is
// wrapped in its own NextIntlClientProvider there.
//
// 🔒 outward-facing (participant share link): no search-engine indexing/cache.

export const metadata: Metadata = {
  title: 'Research-Canvas — Interview schedule',
  description: 'Your interview schedule and messages.',
  robots: { index: false, follow: false, nocache: true },
};

// Participants open this share link mostly on phones. `viewportFit: 'cover'`
// lets the page extend under the iOS notch/home-bar so the `env(safe-area-inset-*)`
// padding on <body> below can push content clear of them (the insets resolve to
// 0 on non-notched/desktop, so nothing changes there).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function ScheduleParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${outfit.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      {/* Safe-area insets (paired with viewportFit:'cover' above) keep every
          participant view — schedule, phone-gate, invalid-notice — clear of the
          iOS notch/home-bar/rounded corners. Each inset is 0 on non-notched and
          desktop devices, so this is a no-op there. */}
      <body
        className="h-full bg-paper text-ink"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        {children}
      </body>
    </html>
  );
}
