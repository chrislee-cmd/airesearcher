import { setRequestLocale } from 'next-intl/server';
import { ReportGenerator } from '@/components/report-generator';
import { Coachmark } from '@/components/coachmark';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <Coachmark feature="reports" />
      <ReportGenerator />
    </>
  );
}
