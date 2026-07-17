import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ChapterHeader } from '@/components/editorial';
import { getCurrentUser } from '@/lib/supabase/user';
import { ExportData } from './export-data';
import { DangerZone } from './danger-zone';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations({ locale, namespace: 'Settings' });

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-6">
      <ChapterHeader
        title={t('title')}
        description={t('description')}
      />
      <ExportData />
      <DangerZone email={user.email ?? ''} />
    </div>
  );
}
