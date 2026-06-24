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
// 리서치 흐름 순 — recruiting (모집) → quotes/desk/interviews (수집·분석) →
// moderator/translate/probing (진행) → topline/slidegen (산출).
// probing 은 translate 의 transcript 를 구독하므로 translate 바로 다음.
export const CANVAS_ORDER: CanvasWidgetKey[] = [
  'recruiting',
  'quotes',
  'desk',
  'interviews',
  'moderator',
  'translate',
  'probing',
  'topline',
  'slidegen',
];

export function visibleCanvasWidgets(): CanvasWidgetKey[] {
  return CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]);
}
