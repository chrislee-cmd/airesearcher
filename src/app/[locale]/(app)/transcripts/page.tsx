import { setRequestLocale } from 'next-intl/server';
import { requirePreviewAccess } from '@/lib/preview-gate';
import { TranscriptsCanvas } from './transcripts-canvas';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('transcripts', locale);
  return <TranscriptsCanvas />;
}
