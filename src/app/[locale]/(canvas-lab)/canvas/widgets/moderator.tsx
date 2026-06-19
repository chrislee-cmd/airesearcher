'use client';

import type { WidgetContent } from '../widget-types';
import { CTA, Label } from '../shell/primitives';

function PrimaryAction() {
  return (
    <div className="space-y-3">
      <Label>가이드 종류</Label>
      <div className="grid grid-cols-3 gap-2">
        {[
          { k: 'IDI', d: '심층 인터뷰' },
          { k: 'FGD', d: '포커스 그룹' },
          { k: 'UT', d: '사용성 테스트' },
        ].map((g, i) => (
          <button
            key={g.k}
            className={`rounded-xs border px-3 py-3 text-left hover:border-ink ${
              i === 0 ? 'border-amore bg-amore-bg' : 'border-line bg-paper'
            }`}
          >
            <div className="text-md font-medium text-ink">{g.k}</div>
            <div className="mt-0.5 text-xs text-mute">{g.d}</div>
          </button>
        ))}
      </div>
      <div>
        <Label>조사 목적 (한 줄)</Label>
        <input
          className="mt-1.5 w-full rounded-xs border border-line bg-paper px-3 py-2 text-md text-ink placeholder:text-mute-soft focus:border-ink focus:outline-none"
          placeholder="예: 신규 앱 온보딩 단계 마찰 진단"
        />
      </div>
      <CTA label="가이드 생성 →" />
    </div>
  );
}

export const moderatorContent: WidgetContent = {
  key: 'moderator',
  meta: {
    label: 'AI 모더레이터',
    subtitle: '조사 목적과 대상자만 입력하면 IDI/FGD 가이드 초안 자동 생성',
    cost: 1,
    accent: 'peach',
  },
  state: 'idle',
  stats: [
    { label: '이번 달 생성', value: '8개' },
    { label: '평균 질문 수', value: '24개' },
    { label: '평균 인터뷰', value: '60분' },
  ],
  recents: [
    { name: '40대 워킹맘 IDI 가이드', meta: '2026.06.17 · 22 questions' },
    { name: '신규 앱 UT FGD 가이드', meta: '2026.06.12 · 18 questions' },
    { name: '시니어 핀테크 IDI 가이드', meta: '2026.06.08 · 26 questions' },
  ],
  PrimaryAction,
  expandedHeight: 500,
};
