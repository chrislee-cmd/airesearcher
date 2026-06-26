/* ────────────────────────────────────────────────────────────────────
   /canvas layout — pop 잠금 디자인 (PR-D2 재정의).

   - Outfit 폰트만 import (다른 22 폰트 없음). 헤더 banner-top 의 32px
     label 에서 var(--font-outfit) 로 사용.
   - data-canvas 는 layout 이 아니라 canvas-board (h-full 컨테이너) 에
     부착 — bg 가 canvas 영역에만 적용되도록.
   - 적용 범위 /canvas 한정. 다른 라우트 영향 0.
   ──────────────────────────────────────────────────────────────────── */

import { Outfit } from 'next/font/google';
import type { ReactNode } from 'react';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

export default function CanvasLayout({ children }: { children: ReactNode }) {
  return <div className={`${outfit.variable} h-full`}>{children}</div>;
}
