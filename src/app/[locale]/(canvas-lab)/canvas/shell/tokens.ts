/* ────────────────────────────────────────────────────────────────────
   Canvas shell tokens — 시각 시스템 (액센트 색 / 상태 pill / layout 상수).
   도구 종속 X. 모든 위젯이 공유.
   ──────────────────────────────────────────────────────────────────── */

import type { AccentColor, WidgetState } from '../widget-types';

export const CARD_W = 680;
export const CARD_H_COLLAPSED = 88;
export const ROW_GAP = 40;
export const COL_X = 200;
export const TOP_OFFSET = 96;

export const ACCENT_BG: Record<AccentColor, string> = {
  sky: 'bg-sky',
  peach: 'bg-peach',
  mint: 'bg-mint',
  lav: 'bg-lav',
  sun: 'bg-sun',
  rose: 'bg-rose',
};

export const ACCENT_ICON: Record<AccentColor, string> = {
  sky: '◐',
  peach: '◆',
  mint: '◉',
  lav: '◇',
  sun: '★',
  rose: '✦',
};

export function statePill(state: WidgetState): { label: string; cls: string } {
  switch (state) {
    case 'running':
      return { label: '진행 중', cls: 'bg-amore-bg text-amore' };
    case 'done':
      return { label: '완료', cls: 'bg-mint text-ink' };
    case 'error':
      return { label: '오류', cls: 'bg-warning-bg text-warning' };
    case 'idle':
    default:
      return { label: '대기', cls: 'bg-paper text-mute' };
  }
}
