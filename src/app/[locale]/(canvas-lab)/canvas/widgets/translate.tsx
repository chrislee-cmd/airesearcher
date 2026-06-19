'use client';

import type { WidgetContent } from '../widget-types';

function PrimaryAction() {
  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-mint bg-mint/30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-pill bg-success" />
            </span>
            <span className="text-md font-medium text-ink">LIVE · KO → EN</span>
          </div>
          <span className="text-xs text-mute">진행 시간 32:14</span>
        </div>
        <div className="mt-2 rounded-xs bg-paper-soft px-3 py-2 text-sm text-ink">
          “저희가 처음에 광고를 봤을 때 가장 인상적이었던 부분은…”
          <div className="mt-1 text-xs text-mute">
            → “When we first saw the ad, the most striking part was…”
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="rounded-xs border border-line bg-paper px-3 py-2 text-md text-ink hover:border-ink">
          ⏸  일시정지
        </button>
        <button className="rounded-xs border border-warning bg-warning-bg px-3 py-2 text-md text-warning hover:opacity-90">
          ■  세션 종료
        </button>
      </div>
      <button className="w-full rounded-xs border border-line bg-paper px-3 py-2 text-md text-mute hover:border-ink hover:text-ink">
        + 새 세션 시작
      </button>
    </div>
  );
}

export const translateContent: WidgetContent = {
  key: 'translate',
  meta: {
    label: 'AI 통역사',
    subtitle: '실시간 KO↔EN/JP/CN 통역 · 인터뷰 / 미팅 라이브 자막',
    cost: 50,
    accent: 'mint',
  },
  state: 'running',
  progress: 67,
  phaseLabel: 'LIVE · KO → EN',
  stats: [
    { label: '누적 통역', value: '14h 32m', trend: 'up' },
    { label: '평균 지연', value: '480ms' },
    { label: '정확도', value: '96%' },
  ],
  recents: [
    { name: 'P&G Asia 화상 미팅', meta: '2026.06.18 · 52분 · KO↔EN' },
    { name: '일본 본사 인터뷰', meta: '2026.06.14 · 38분 · KO↔JP' },
    { name: '글로벌 UT 세션 3', meta: '2026.06.10 · 1h 22m · KO↔EN' },
  ],
  PrimaryAction,
  expandedHeight: 580,
};
