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
  | 'slidegen'
  // 신 placeholder 위젯 3장 (3×3 우측 열). backend 없이 "준비 중" 안내만.
  | 'guideline'
  | 'moderator_ai'
  | 'ppt_report';

export const CANVAS_VISIBILITY: Record<CanvasWidgetKey, boolean> = {
  // Row 1 (amore): 리크루팅 | 데스크 | 가이드라인
  recruiting: true,
  desk: true,
  guideline: true,
  // Row 2 (ink-2): 프로빙 | 동시통역 | AI 모더레이터
  probing: true,
  translate: true,
  moderator_ai: true,
  // Row 3 (mute): 전사록 | 인터뷰 결과 | PPT 보고서
  quotes: true,
  interviews: true,
  ppt_report: true,
  // Hidden (옛 — visibility=false)
  moderator: false,
  topline: false,
  slidegen: false,
};

// canvas page 가 렌더 순서를 정할 때 reference 하는 고정 순서.
// row-major 3×3 배치 (canvas-board GRID_COLS=3) — 좌→우, 위→아래로 채움.
//   Row 1 (상): recruiting | desk       | guideline
//   Row 2 (중): probing    | translate  | moderator_ai
//   Row 3 (하): quotes(전사록) | interviews(인터뷰 결과) | ppt_report
// hidden 3장 (moderator/topline/slidegen) 은 뒤에 두고 visibility=false 로 제외.
export const CANVAS_ORDER: CanvasWidgetKey[] = [
  // Row 1 (상)
  'recruiting',
  'desk',
  'guideline',
  // Row 2 (중)
  'probing',
  'translate',
  'moderator_ai',
  // Row 3 (하)
  'quotes',
  'interviews',
  'ppt_report',
  // Hidden (order 유지, visibility=false)
  'moderator',
  'topline',
  'slidegen',
];

export function visibleCanvasWidgets(): CanvasWidgetKey[] {
  return CANVAS_ORDER.filter((k) => CANVAS_VISIBILITY[k]);
}

// 순차 배포 후순위 — 일반(비-unlimited) 계정 캔버스에서 숨기는 placeholder
// 위젯 키 (2026-07-14, card 600). 이 둘은 FeatureKey 가 아니라 캔버스 전용
// placeholder 키라 PREVIEW_FEATURES 로는 못 가린다 → 키 레벨에서 제외한다.
// canvas/page.tsx 의 visible 필터가 unlimited(관리자)는 우회하므로 관리자
// 캔버스는 9개 그대로(회귀 0). 되돌리기 = 이 세트를 비우면 즉시 노출.
export const CANVAS_NORMAL_HIDDEN: ReadonlySet<CanvasWidgetKey> =
  new Set<CanvasWidgetKey>(['guideline', 'ppt_report']);
