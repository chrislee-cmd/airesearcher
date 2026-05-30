import { setRequestLocale } from 'next-intl/server';
import { SchedulerPage } from '@/components/scheduler/scheduler-page';
import { requirePreviewAccess } from '@/lib/preview-gate';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('scheduler', locale);
  return <SchedulerPage />;
}
