import { setRequestLocale } from 'next-intl/server';
import { TranscriptStudio } from '@/components/transcript-studio';

// canvas 카드 디자인 — 본문 자체가 라벨/상태/비용 헤더를 들고 있어서
// FeaturePage wrapper 의 페이지 헤더는 중복. 카드가 페이지 전체 chrome.
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TranscriptStudio />;
}
