import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import '../globals.css';

// Public viewer for live interpretation share links. Lives at the top
// level (outside `[locale]`) so it bypasses next-intl middleware, the
// `(app)` provider stack, and any auth redirect — anyone with the link
// can open it without signing in. Locale is negotiated client-side
// inside the viewer component if needed.

// Outfit display font — the observer redesign (Memphis, CD frames 01–06)
// renders the header title, unlock/ended headings, and caption lines in
// Outfit (§F4 STREAM_FONT). This route lives outside `(app)`, so its
// `--font-outfit` variable is defined here (mirrors `(app)/layout.tsx` and
// `schedule/layout.tsx`); components consume it via inline
// `fontFamily: 'var(--font-outfit), var(--font-sans)'`.
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Research-Canvas — Live',
  description: 'AI simultaneous interpretation, live.',
  robots: { index: false, follow: false, nocache: true },
};

export default function ViewerLayout({
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
      <body className="h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
