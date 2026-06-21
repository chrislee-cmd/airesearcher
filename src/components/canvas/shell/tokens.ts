/* ────────────────────────────────────────────────────────────────────
   Canvas shell tokens — 액센트 색상 매핑 + 상태 pill.
   도구 종속 X. 모든 위젯이 공유. canvas-lab 패턴을 production 으로
   가져오면서 layout 상수 (CARD_W/H/COL_X 등) 는 제거 — production 셸은
   absolute 좌표가 아닌 flex/space-y 스택을 쓰므로 불필요.
   ──────────────────────────────────────────────────────────────────── */

import type { AccentColor, WidgetState } from '../widget-types';

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
