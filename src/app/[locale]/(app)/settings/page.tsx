import { setRequestLocale } from 'next-intl/server';
import { ChapterHeader } from '@/components/editorial';
import { ExportData } from './export-data';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader
        title="설정"
        description="계정과 개인정보를 관리합니다."
      />
      <ExportData />
    </div>
  );
}
