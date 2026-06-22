import { redirect } from 'next/navigation';
import { requirePreviewAccess } from '@/lib/preview-gate';

// `/live` 직접 진입은 `/canvas` 의 AI 동시통역 카드 자동 expanded 로 흡수.
// preview gate 는 기존과 동일 — is_unlimited org 가 아니면 /dashboard 로
// redirect (requirePreviewAccess 내부에서 throw + redirect). admin 만 canvas
// 의 translate 카드 진입.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requirePreviewAccess('translate', locale);
  redirect(`/${locale}/canvas?focus=translate`);
}
