'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskStartedHandoff — 세팅 CTA(검색) 후 in-place 핸드오프 프롬프트.

   CD 파일럿 #2 (`design-handoff/desk/` §3 started 상태). 검색을 시작하면
   세팅 아코디언 자리를 이 프롬프트가 대체한다: 대형 아이콘 박스 + "전체
   보기에서 확인" 안내 + 부제 + 하단 액션(전체 보기 / 정지). 실제 크롤
   진행·리포트는 fullview(PR2) 가 소유 — 이 카드 본문은 핸드오프만.

   `design-handoff/desk/HANDOFF.md`: "Started → in-place Handoff (crawling).
   Report renders in fullview." 스펙이 재사용하라던 `WidgetLiveFullviewPrompt`
   는 base(integ/desk-v2 = main 분기)에 없어 WIDGET-SHELL 시각 계약에 맞춰
   신규 작성 (PR 본문 마찰 기록). 토큰 SSOT — raw hex/px 0.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

function FullviewGlyph() {
  return (
    <svg
      className="size-8"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
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
  // 전체 보기 진입 (아이콘 박스 + 링크 클릭).
  onFullview: () => void;
  fullviewLabel: string;
  // 하단 액션 슬롯 (정지 버튼 등 — 호출부 소유).
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-5 py-8 text-center">
      {/* 아이콘 박스 = 시각 어포던스(장식). 실 클릭 진입점은 아래 링크 —
          중복 인터랙티브 요소 제거 (a11y + native button 회피). */}
      <div
        aria-hidden
        className="flex size-16 items-center justify-center rounded-md border-2 border-ink text-ink shadow-memphis-md"
      >
        <FullviewGlyph />
      </div>
      <div className="text-3xl font-extrabold leading-tight text-ink">
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
