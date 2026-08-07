'use client';

import { Pressable } from '@/components/artifacts/library/pressable';
import type { ShareScope } from './types';

// 소유자 스코프 세그먼트(§0.5, admin/owner 한정 · canViewOrgScope) — 헤더에 둔다
// (스코프는 헤더, 상태는 툴바). member 에게는 이 컴포넌트를 아예 렌더하지 않는다
// (잠긴 토글도 아님 — 없음). 아이콘은 currentColor 스트로크라 셀 상태(활성=paper /
// 비활성=mute)에 따라 자동으로 리컬러된다.

// 내 링크 = 단일 인물. 조직 전체 = 두 인물. .dc.html 경로 그대로(pure stroke).
function PersonGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx={12} cy={8} r={3.4} />
      <path d="M5.5 20v-1.4A6.5 6.5 0 0 1 12 12.2a6.5 6.5 0 0 1 6.5 6.4V20" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx={9} cy={8} r={3} />
      <path d="M3 20v-1.2A5.8 5.8 0 0 1 9 13a5.8 5.8 0 0 1 6 5.8V20" />
      <path d="M16.5 5.6a3 3 0 0 1 0 4.8M18.6 13.6A5 5 0 0 1 21 18v2" />
    </svg>
  );
}

export function ShareScopeToggle({
  scope,
  onScope,
  labels,
}: {
  scope: ShareScope;
  onScope: (s: ShareScope) => void;
  labels: { mine: string; org: string };
}) {
  const cell = 'flex items-center gap-1.5 px-[13px] py-1.5 text-md';
  return (
    <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-pill border-[1.5px] border-ink bg-paper shadow-memphis-sm">
      <Pressable
        onPress={() => onScope('mine')}
        ariaLabel={labels.mine}
        className={`${cell} ${scope === 'mine' ? 'bg-ink font-extrabold text-paper' : 'font-bold text-mute'}`}
      >
        <PersonGlyph />
        {labels.mine}
      </Pressable>
      <span className="w-[1.5px] bg-ink" />
      <Pressable
        onPress={() => onScope('org')}
        ariaLabel={labels.org}
        className={`${cell} ${scope === 'org' ? 'bg-ink font-extrabold text-paper' : 'font-bold text-mute'}`}
      >
        <PeopleGlyph />
        {labels.org}
      </Pressable>
    </span>
  );
}
