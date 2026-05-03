import { setRequestLocale, getTranslations } from 'next-intl/server';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Sidebar');

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings')}</h1>
      <p className="mt-2 text-sm text-neutral-500">Coming soon.</p>
    </div>
  );
}
