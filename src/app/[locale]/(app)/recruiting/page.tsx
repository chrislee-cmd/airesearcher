import { redirect } from 'next/navigation';
import { requirePreviewAccess } from '@/lib/preview-gate';

// `/recruiting` 직접 진입은 `/canvas` 의 리크루팅 카드 자동 expanded 로 흡수.
// preview gate 는 기존과 동일 — is_unlimited org 가 아니면 /dashboard 로
// redirect (requirePreviewAccess 내부에서 redirect). admin 만 canvas 의
// recruiting 카드 자동 expanded 로 진입.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePreviewAccess('recruiting', locale);
  redirect(`/${locale}/canvas?focus=recruiting`);
}
