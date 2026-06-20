import { setRequestLocale } from 'next-intl/server';

export default async function CanvasLabLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="h-screen w-screen overflow-hidden bg-paper">{children}</div>;
}
