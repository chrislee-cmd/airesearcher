import { setRequestLocale } from 'next-intl/server';
import { SchedulerPage } from '@/components/scheduler/scheduler-page';
import { Coachmark } from '@/components/coachmark';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <Coachmark feature="scheduler" />
      <SchedulerPage />
    </>
  );
}
