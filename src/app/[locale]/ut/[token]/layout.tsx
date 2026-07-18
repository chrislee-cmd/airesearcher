import type { Metadata } from 'next';

// 원격 AI UT 참가자(624) 공개 라우트 — (app) 셸 밖 독립 프레임.
//
// [locale]/layout 이 html/body/NextIntlClientProvider/AuthProvider 를 이미
// 제공하므로(익명 user=null 통과) 여기서는 robots noindex 만 덮어쓴다. (app)
// 의 사이드바·프로바이더 스택은 상속하지 않는다 — 이 라우트는 (app) 의
// 형제라 좌 사이드바·편집 컨트롤이 아예 렌더되지 않는다.
//
// 🔒 outward-facing(참가자 공개 링크): 검색엔진 인덱싱·캐시 방지.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function UtParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
