import { setRequestLocale } from 'next-intl/server';
import { DeskResearch } from '@/components/desk-research';
import { CoachmarkTour } from '@/components/coachmark-tour';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <CoachmarkTour feature="desk" />
      <DeskResearch />
    </>
  );
}
