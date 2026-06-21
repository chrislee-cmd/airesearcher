/* ────────────────────────────────────────────────────────────────────
   Canvas widget visibility — PR1 은 hard-coded map.
   PR3 에서 db 연동 (org flags / super-admin role) 으로 교체 예정.

   - 모든 6장 카드 키를 union 으로 노출 (cardId 자동 expanded 진입을 위한
     SSOT).
   - 현재 quotes / desk 만 노출. moderator/translate/topline/slidegen 은
     PR2 본문 합쳐지면 visibility map 만 true 로 바꾸면 자동 노출.
   ──────────────────────────────────────────────────────────────────── */

export type CanvasWidgetKey =
  | 'quotes'
  | 'desk'
  | 'moderator'
  | 'translate'
  | 'topline'
  | 'slidegen';

export const CANVAS_VISIBILITY: Record<CanvasWidgetKey, boolean> = {
  quotes: true,
  desk: true,
  moderator: false,
  translate: false,
  topline: false,
  slidegen: false,
};

// canvas page 가 렌더 순서를 정할 때 reference 하는 고정 순서.
// FEATURE_GROUPS 에서 자연스러운 카테고리 순서 (수집 → 진행 → 분석 → 산출)
// 와 비슷하게 — quotes/desk (수집·리서치) → moderator/translate (진행) →
// topline/slidegen (산출).
export const CANVAS_ORDER: CanvasWidgetKey[] = [
  'quotes',
  'desk',
  'moderator',
  'translate',
  'topline',
  'slidegen',
];

export function visibleCanvasWidgets(): CanvasWidgetKey[] {
  return CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]);
}
