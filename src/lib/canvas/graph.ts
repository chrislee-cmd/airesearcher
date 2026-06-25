/* ────────────────────────────────────────────────────────────────────
   Canvas graph SSOT — n8n 스타일 워크플로우 캔버스의 노드 기본 좌표 +
   연결 edge 정의.

   - 좌표계: 캔버스 surface 좌상단 (0,0) 기준 px. 위젯 width / height 와
     함께 layout 계산.
   - 기본 layout: 리서치 흐름 left → right.
       col0 (recruiting / translate / desk) → col1 (interviews / probing)
       → col2 (quotes)
   - Edge: 의미 있는 데이터 흐름만 (저자의 narrative 기반).
     RealtimeTranscriptProvider 가 실제로 wire-up 한 translate↔probing 은
     실시간이라 별도 표시 (animated).
   ──────────────────────────────────────────────────────────────────── */

import type { CanvasWidgetKey } from './visibility';

export const NODE_DEFAULT_W = 816; // 모든 visible 위젯이 expandedCols=3
export const NODE_DEFAULT_H = 800;
export const NODE_COLLAPSED_H = 116; // header 만 보이는 collapsed 모드
export const NODE_GAP_X = 240; // 노드 간 horizontal 여백 (edge 가 그어질 공간)
export const NODE_GAP_Y = 160;
export const CANVAS_W = 3 * NODE_DEFAULT_W + 2 * NODE_GAP_X + 320; // 좌우 padding
export const CANVAS_H = 3 * NODE_DEFAULT_H + 2 * NODE_GAP_Y + 320;
export const GRID_STEP = 8; // free positioning 의 sub-snap (drag 시)

export type NodePosition = { x: number; y: number };

// 기본 위치 — 워크플로우 단계별로 컬럼 배치. localStorage 가 없을 때 fallback.
const COL_X = [160, 160 + NODE_DEFAULT_W + NODE_GAP_X, 160 + 2 * (NODE_DEFAULT_W + NODE_GAP_X)];

export const DEFAULT_NODE_POSITIONS: Record<CanvasWidgetKey, NodePosition> = {
  // col 0 — input 단계 (모집 / 라이브 통역 / 데스크 리서치)
  recruiting: { x: COL_X[0], y: 160 },
  translate:  { x: COL_X[0], y: 160 + NODE_DEFAULT_H + NODE_GAP_Y },
  desk:       { x: COL_X[0], y: 160 + 2 * (NODE_DEFAULT_H + NODE_GAP_Y) },
  // col 1 — process 단계 (인터뷰 정리 / 라이브 프로빙)
  interviews: { x: COL_X[1], y: 160 },
  probing:    { x: COL_X[1], y: 160 + NODE_DEFAULT_H + NODE_GAP_Y },
  moderator:  { x: COL_X[1], y: 160 + 2 * (NODE_DEFAULT_H + NODE_GAP_Y) },
  // col 2 — output 단계 (전사 → 리포트 / 슬라이드)
  quotes:     { x: COL_X[2], y: 160 + (NODE_DEFAULT_H + NODE_GAP_Y) / 2 },
  topline:    { x: COL_X[2], y: 160 + (NODE_DEFAULT_H + NODE_GAP_Y) * 1.5 },
  slidegen:   { x: COL_X[2], y: 160 + (NODE_DEFAULT_H + NODE_GAP_Y) * 2.5 },
};

export type Edge = {
  from: CanvasWidgetKey;
  to: CanvasWidgetKey;
  // 'live' = 실시간 데이터 구독 (RealtimeTranscriptProvider 등). animated.
  // 'flow' = 일반 워크플로우 (사람이 다음 단계로 넘어가는). static.
  kind: 'live' | 'flow';
  label?: string;
};

// 의미 있는 데이터 흐름만. 보이지 않는 widget (visibility=false) 이 한 쪽이면
// edge 도 자동 숨김 (canvas-edges 에서 필터).
export const EDGES: Edge[] = [
  { from: 'recruiting', to: 'interviews', kind: 'flow', label: '모집 → 세션' },
  { from: 'translate',  to: 'probing',    kind: 'live', label: '실시간 전사' },
  { from: 'interviews', to: 'quotes',     kind: 'flow', label: '인용 추출' },
  { from: 'desk',       to: 'topline',    kind: 'flow', label: '컨텍스트' },
  { from: 'quotes',     to: 'topline',    kind: 'flow', label: '인용 → 리포트' },
  { from: 'topline',    to: 'slidegen',   kind: 'flow', label: '리포트 → PPT' },
];

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}
