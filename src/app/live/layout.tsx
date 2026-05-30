import type { Metadata } from 'next';
import '../globals.css';

// Public viewer for live interpretation share links. Lives at the top
// level (outside `[locale]`) so it bypasses next-intl middleware, the
// `(app)` provider stack, and any auth redirect — anyone with the link
// can open it without signing in. Locale is negotiated client-side
// inside the viewer component if needed.

export const metadata: Metadata = {
  title: 'Research-mochi — Live',
  description: 'AI simultaneous interpretation, live.',
  robots: { index: false, follow: false, nocache: true },
};

export default function ViewerLayout({
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
