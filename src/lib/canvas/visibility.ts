/* ────────────────────────────────────────────────────────────────────
   Canvas widget visibility — PR1 은 hard-coded map.
   PR3 에서 db 연동 (org flags / super-admin role) 으로 교체 예정.

   - 모든 6장 카드 키를 union 으로 노출 (cardId 자동 expanded 진입을 위한
     SSOT).
   - 현재 quotes / desk 만 노출. moderator/translate/topline/slidegen 은
     PR2 본문 합쳐지면 visibility map 만 true 로 바꾸면 자동 노출.
   ──────────────────────────────────────────────────────────────────── */

export type CanvasWidgetKey =
  | 'recruiting'
  | 'quotes'
  | 'desk'
  | 'interviews'
  | 'moderator'
  | 'translate'
  | 'probing'
  | 'topline'
  | 'slidegen';

export const CANVAS_VISIBILITY: Record<CanvasWidgetKey, boolean> = {
  recruiting: true,
  quotes: true,
  desk: true,
  interviews: true,
  moderator: false,
  translate: true,
  probing: true,
  topline: false,
  slidegen: false,
};

// canvas page 가 렌더 순서를 정할 때 reference 하는 고정 순서.
// row-major 2×3 배치 (canvas-board GRID_COLS=2) — 좌→우, 위→아래로 채움.
//   Row 1 (상): recruiting | desk
//   Row 2 (중): probing    | translate
//   Row 3 (하): quotes(전사록) | interviews(인터뷰 결과 생성기)
// hidden 3장 (moderator/topline/slidegen) 은 뒤에 두고 visibility=false 로 제외.
export const CANVAS_ORDER: CanvasWidgetKey[] = [
  // Row 1 (상)
  'recruiting',
  'desk',
  // Row 2 (중)
  'probing',
  'translate',
  // Row 3 (하)
  'quotes',
  'interviews',
  // Hidden (order 유지, visibility=false)
  'moderator',
  'topline',
  'slidegen',
];

export function visibleCanvasWidgets(): CanvasWidgetKey[] {
  return CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]);
}
