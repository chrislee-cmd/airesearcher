import { setRequestLocale } from 'next-intl/server';
import { RecruitingBrief } from '@/components/recruiting-brief';
import { requirePreviewAccess } from '@/lib/preview-gate';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePreviewAccess('recruiting', locale);
  return <RecruitingBrief />;
}
