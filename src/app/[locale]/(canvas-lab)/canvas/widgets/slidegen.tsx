'use client';

import type { WidgetContent } from '../widget-types';
import { CTA, Label } from '../shell/primitives';

function PrimaryAction() {
  return (
    <div className="space-y-3">
      <Label>템플릿</Label>
      <div className="grid grid-cols-4 gap-2">
        {['표준', '임원 보고', '클라이언트 발표', '팀 공유'].map((t, i) => (
          <button
            key={t}
            className={`flex h-20 flex-col items-center justify-center rounded-xs border text-xs ${
              i === 1
                ? 'border-amore bg-amore-bg text-amore'
                : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
            }`}
          >
            <div className="mb-1 h-7 w-12 rounded-xs border border-current opacity-60" />
            {t}
          </button>
        ))}
      </div>
      <div>
        <Label>원본 선택</Label>
        <button className="mt-1.5 flex w-full items-center justify-between rounded-xs border border-line bg-paper px-3 py-2.5 text-md text-ink hover:border-ink">
          <span>광고 시장 동향 2026 Q2 (리포트)</span>
          <span className="text-mute-soft">⌄</span>
        </button>
      </div>
      <CTA label="슬라이드 생성 →" />
    </div>
  );
}

export const slidegenContent: WidgetContent = {
  key: 'slidegen',
  meta: {
    label: 'PPT 생성기',
    subtitle: '리포트 · Topline 결과를 발표용 슬라이드 덱으로',
    cost: 0,
    accent: 'rose',
  },
  state: 'idle',
  stats: [
    { label: '이번 달 슬라이드', value: '6개' },
    { label: '평균 슬라이드 수', value: '18장' },
    { label: '평균 생성 시간', value: '2분' },
  ],
  recents: [
    { name: '광고 시장 동향 — 발표용', meta: '24 slides · 2026.06.18' },
    { name: '신메뉴 Topline — 임원 보고', meta: '12 slides · 2026.06.13' },
    { name: 'UT 결과 종합 — 팀 공유', meta: '32 slides · 2026.06.05' },
  ],
  PrimaryAction,
  expandedHeight: 520,
};
