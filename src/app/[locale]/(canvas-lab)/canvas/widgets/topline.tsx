'use client';

import type { WidgetContent } from '../widget-types';
import { CTA, Label } from '../shell/primitives';

function PrimaryAction() {
  return (
    <div className="space-y-3">
      <div>
        <Label>분석 대상</Label>
        <button className="mt-1.5 flex w-full items-center justify-between rounded-xs border border-line bg-paper px-3 py-2.5 text-md text-ink hover:border-ink">
          <span>광고 캠페인 A/B (n=420) · 2026.06.16</span>
          <span className="text-mute-soft">⌄</span>
        </button>
      </div>
      <div>
        <Label>출력 형식</Label>
        <div className="mt-1.5 flex gap-1.5">
          {['1-pager PDF', 'HTML', 'Slack 카드'].map((f, i) => (
            <button
              key={f}
              className={`rounded-pill border px-3 py-1 text-xs ${
                i === 0
                  ? 'border-amore bg-amore-bg text-amore'
                  : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <CTA label="Topline 생성 →" />
    </div>
  );
}

export const toplineContent: WidgetContent = {
  key: 'topline',
  meta: {
    label: 'Topline 생성기',
    subtitle: '정량 데이터 + 인터뷰 결과를 한 페이지 헤드라인 요약으로',
    cost: 50,
    accent: 'sun',
  },
  state: 'idle',
  stats: [
    { label: '이번 달 생성', value: '5건' },
    { label: '평균 응답 수', value: '240' },
    { label: '평균 처리 시간', value: '5분' },
  ],
  recents: [
    { name: '광고 캠페인 A/B Topline', meta: '2026.06.16 · n=420' },
    { name: '신메뉴 컨셉 Topline', meta: '2026.06.12 · n=180' },
    { name: '브랜드 이미지 트래커', meta: '2026.06.07 · n=600' },
  ],
  PrimaryAction,
  expandedHeight: 460,
};
