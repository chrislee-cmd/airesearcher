import { getTranslations } from 'next-intl/server';
import { MochiLoader } from '@/components/ui/mochi-loader';

export default async function Loading() {
  const t = await getTranslations('Common');
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <MochiLoader size={64} label={t('loading')} />
    </div>
  );
}
