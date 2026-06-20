'use client';

import type { WidgetContent } from '../widget-types';
import { CTA, Label } from '../shell/primitives';

function PrimaryAction() {
  const chips = ['광고 시장', 'D2C', 'MZ세대'];
  return (
    <div className="space-y-3">
      <div>
        <Label>키워드 (5개 이내)</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xs border border-line bg-paper px-2 py-2 min-h-[40px]">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-pill bg-lav px-2.5 py-1 text-xs text-ink"
            >
              {c}
              <span className="text-mute-soft">×</span>
            </span>
          ))}
          <input
            className="flex-1 bg-transparent text-md text-ink placeholder:text-mute-soft focus:outline-none"
            placeholder="+ 추가"
          />
        </div>
      </div>
      <div>
        <Label>출처</Label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {['뉴스', '블로그', '커뮤니티', '리포트'].map((s, i) => (
            <button
              key={s}
              className={`rounded-pill border px-2.5 py-1 text-xs ${
                i < 3
                  ? 'border-amore bg-amore-bg text-amore'
                  : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <CTA label="리서치 시작 →" />
    </div>
  );
}

export const deskContent: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    subtitle: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
    cost: 25,
    accent: 'sky',
  },
  state: 'idle',
  stats: [
    { label: '이번 달 리서치', value: '12회', trend: 'up' },
    { label: '평균 출처 수', value: '14건' },
    { label: '평균 처리 시간', value: '4분 12초' },
  ],
  recents: [
    { name: '광고 시장 동향 2026 Q2', meta: '2026.06.18 · 18 sources' },
    { name: '헬스케어 D2C 경쟁사 스캔', meta: '2026.06.15 · 24 sources' },
    { name: 'MZ 금융 행동 패턴', meta: '2026.06.11 · 9 sources' },
  ],
  PrimaryAction,
  expandedHeight: 540,
};
