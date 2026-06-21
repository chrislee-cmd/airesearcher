import { redirect } from 'next/navigation';

// `/desk` 직접 진입은 `/canvas` 의 데스크 카드 자동 expanded 로 흡수.
// 본문은 src/components/canvas/widgets/desk-card-body.tsx 에 추출되어 있고
// canvas-board 가 `?focus=desk` 를 읽어 해당 카드를 초기 expanded 로 띄움.
// 기존 deep-link / 공유 URL 호환 — 클라이언트 측 history 도 자연스럽게 갱신.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/canvas?focus=desk`);
}
