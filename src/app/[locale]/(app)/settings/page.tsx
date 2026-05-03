import { setRequestLocale } from 'next-intl/server';
import { ChapterHeader } from '@/components/editorial';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader title="설정" description="이 영역은 곧 출시됩니다." />
    </div>
  );
}
