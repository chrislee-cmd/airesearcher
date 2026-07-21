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
  cyan: 'bg-cyan',
};

export const ACCENT_ICON: Record<AccentColor, string> = {
  sky: '◐',
  peach: '◆',
  mint: '◉',
  lav: '◇',
  sun: '★',
  rose: '✦',
  cyan: '◑',
};

// 상태 라벨은 production 셸의 실제 pill(widget-state-pill.tsx)과 동일하게
// 로케일 무관 영어 uppercase Memphis 배지 규약을 따른다 — statePill 은 현재
// production 소비처가 없는 orphan(내부 canvas-lab 은 자체 tokens 사본 사용)
// 이라 라벨을 영어로 정렬해도 렌더 회귀 0.
export function statePill(state: WidgetState): { label: string; cls: string } {
  switch (state) {
    case 'running':
      return { label: 'RUNNING', cls: 'bg-amore-bg text-amore' };
    case 'done':
      return { label: 'DONE', cls: 'bg-mint text-ink' };
    case 'error':
      return { label: 'ERR', cls: 'bg-warning-bg text-warning' };
    case 'idle':
    default:
      return { label: 'READY', cls: 'bg-paper text-mute' };
  }
}
