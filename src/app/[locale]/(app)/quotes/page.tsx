import { redirect } from 'next/navigation';

// `/quotes` 직접 진입은 `/canvas` 의 전사록 카드 자동 expanded 로 흡수.
// 본문은 src/components/canvas/widgets/quotes-card-body.tsx 에 추출되어 있고
// canvas-board 가 `?focus=quotes` 를 읽어 해당 카드를 초기 expanded 로 띄움.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/canvas?focus=quotes`);
}
