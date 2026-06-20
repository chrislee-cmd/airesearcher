import { setRequestLocale } from 'next-intl/server';
import { CanvasMock } from './canvas-mock';

export default async function CanvasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CanvasMock />;
}
