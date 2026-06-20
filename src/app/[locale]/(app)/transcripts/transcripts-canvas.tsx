'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptsCanvas — canvas-lab 의 위젯 카드 디자인을 in-app /transcripts
   본문으로 단독 마운트. 사이드바는 (app) layout 이 책임.
   선택 상태 고정 = 최근 산출물 + 접기 토글 노출. 인스펙터 없음
   (사이드바가 이미 도구 네비 — 중복 회피).
   ──────────────────────────────────────────────────────────────────── */

import { WidgetCard } from '@/app/[locale]/(canvas-lab)/canvas/shell/widget-shell';
import { transcriptsContent } from '@/app/[locale]/(canvas-lab)/canvas/widgets/transcripts';

export function TranscriptsCanvas() {
  return (
    <div className="relative h-full w-full overflow-auto">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(29,27,32,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative mx-auto w-fit py-8">
        <WidgetCard content={transcriptsContent} selected onCollapse={() => {}} />
      </div>
    </div>
  );
}
