'use client';

import { EmptyState } from '@/components/ui/empty-state';

// 리크루팅 fullview 상단 우 위젯 — 응답 분포 통계 slot. 지금은 placeholder
// 이고 다음 spec 이 실제 분포 테이블/차트를 채운다. 레이아웃 골격만 확정.
export function RecruitingDistributionPanel() {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-sm border-[2px] border-ink bg-paper shadow-[2px_2px_0_black]">
      <header className="flex shrink-0 items-center border-b-[1.5px] border-ink/15 px-4 py-2.5">
        <h3 className="text-md font-semibold text-ink">📊 분포 통계</h3>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-3">
        <EmptyState
          tone="subtle"
          title="분포 통계 준비 중"
          description="응답 분포 요약이 곧 여기에 표시됩니다."
        />
      </div>
    </section>
  );
}
