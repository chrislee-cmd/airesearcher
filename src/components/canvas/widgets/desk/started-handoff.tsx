'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskStartedHandoff — 세팅 CTA(검색) 후 in-place 핸드오프 프롬프트
   (CD 파일럿 #2 §3 started, fresh build).

   CD `desk/HANDOFF.md`: "Started → in-place Handoff (crawling). Report renders
   in fullview." 실 크롤 진행·리포트는 fullview(PR2). 이 카드 본문은 핸드오프만:
   대형 아이콘 박스(장식) + "전체 보기에서 확인" + 부제 + 링크/정지.

   canvas cascade 가 text-2xl+ 를 26px 로 강제(canvas-lock) → 타이틀은 hero
   사이즈로 렌더. 아이콘 박스는 div(장식)라 cascade 무관. raw hex/px 0.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

function FullviewGlyph() {
  return (
    <svg className="size-8" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeskStartedHandoff({
  title,
  subtitle,
  onFullview,
  fullviewLabel,
  children,
}: {
  title: string;
  subtitle: string;
  onFullview: () => void;
  fullviewLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-5 py-8 text-center">
      {/* 아이콘 박스 = 시각 어포던스(장식). 실 진입점은 아래 링크. */}
      <div
        aria-hidden
        className="flex size-16 items-center justify-center rounded-sm border-2 border-ink text-ink shadow-memphis-md"
      >
        <FullviewGlyph />
      </div>
      <div className="text-2xl font-extrabold leading-tight text-ink">
        {title}
      </div>
      <p className="max-w-xs text-lg leading-relaxed text-mute">{subtitle}</p>
      <Button variant="link" size="sm" onClick={onFullview}>
        {fullviewLabel}
      </Button>
      {children}
    </div>
  );
}
