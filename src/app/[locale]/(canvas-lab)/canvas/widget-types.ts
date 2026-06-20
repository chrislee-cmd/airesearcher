/* ────────────────────────────────────────────────────────────────────
   Canvas widget — SSOT 타입.
   셸과 컨텐츠 모듈의 계약. 새 위젯 추가는 이 인터페이스만 채우면 됨.
   ──────────────────────────────────────────────────────────────────── */

import type { FC } from 'react';

export type WidgetState = 'idle' | 'running' | 'done' | 'error';

export type AccentColor = 'sky' | 'peach' | 'mint' | 'lav' | 'sun' | 'rose';

export type StatTile = { label: string; value: string; trend?: 'up' };
export type Recent = { name: string; meta: string };
export type QueueItem = { name: string; progress: number; eta: string };

export type WidgetContent = {
  key: string;
  meta: {
    label: string;
    subtitle: string;
    cost: number;
    accent: AccentColor;
  };
  state: WidgetState;
  progress?: number;
  phaseLabel?: string;
  stats: StatTile[];
  recents: Recent[];
  queue?: QueueItem[];
  PrimaryAction: FC;
  // 펼친 상태의 카드 높이 (px). 셸이 y 좌표 누적 계산에 사용.
  expandedHeight: number;
};
