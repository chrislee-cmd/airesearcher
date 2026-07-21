import type { Metadata, Viewport } from 'next';

// 공유 뷰어 라우트 — (app) 셸 밖 독립 read-only 프레임(결정 1).
//
// [locale]/layout 이 html/body/intl/AuthProvider 를 이미 제공하므로 여기서는
// robots noindex 만 덮어쓴다. (app)/layout 의 사이드바·프로바이더 스택은
// 상속하지 않는다 — 이 라우트는 (app) 의 형제라 좌 사이드바·편집 컨트롤이
// 아예 렌더되지 않는다.
//
// 🔒 outward-facing: 검색엔진 인덱싱·캐시 방지.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// 📱 모바일 뷰어 — 참석자는 대부분 폰 링크로 진입한다. viewport-fit=cover 로
// iOS notch/홈바 영역까지 캔버스를 확장해야 프레임의 env(safe-area-inset-*)
// 패딩이 실제 인셋값으로 해석된다(share 라우트 스코프 전용 — 앱 셸 미영향).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function ShareViewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
