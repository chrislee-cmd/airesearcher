import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

// 격리 layout — (app) 의 사이드바/Provider 체인 완전 차단.
// 디자인 시안 비교용 isolated sandbox. production 영향 0.
export default async function DesignExploreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <>{children}</>;
}
