import { redirect } from 'next/navigation';

// `/interviews` 직접 진입은 `/canvas` 의 인터뷰 카드 자동 expanded 로 흡수.
// 본문은 src/components/canvas/widgets/interviews-card.tsx 에서 InterviewAnalyzer
// 를 widget body 로 마운트하고, canvas-board 가 `?focus=interviews` 를 읽어
// 해당 카드를 초기 expanded 로 띄움.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/canvas?focus=interviews`);
}
