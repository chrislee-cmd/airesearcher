import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURES } from '@/lib/features';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Features');
  const tSidebar = await getTranslations('Sidebar');

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{tSidebar('dashboard')}</h1>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link
            key={f.key}
            href={f.href}
            className="group rounded-xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-base font-medium">{t(`${f.key}.title`)}</h2>
              <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {t(`${f.key}.cost`)}
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-500">{t(`${f.key}.description`)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
