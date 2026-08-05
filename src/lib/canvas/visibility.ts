/* ────────────────────────────────────────────────────────────────────
   Canvas widget visibility.

   - CANVAS_VISIBILITY = **코드 기본값(fallback)**. 실제 노출은 이제 DB 플래그
     (widget_visibility 테이블)가 이 위에 override 한다 — getCanvasVisibility()
     (visibility-server.ts)가 요청당 1회 로드. 슈퍼어드민이 /admin/widget-
     visibility 에서 토글하면 즉시 반영되고, DB 조회 실패 시 이 맵으로 fallback.
   - 모든 카드 키를 union 으로 노출 (cardId 자동 expanded 진입을 위한 SSOT).
   - moderator/topline/slidegen = 옛 위젯(코드 기본 false). 토글 화면 미노출 —
     되살리기는 코드 소관 유지.

   ⚠️ 이 파일은 client-safe(순수 타입/상수)여야 한다 — canvas/page.tsx 외에
   client 컴포넌트가 import 할 수 있으므로 server-only(next/headers·supabase
   server) 코드를 두지 말 것. DB 로딩은 visibility-server.ts 에.
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

// 슈퍼어드민 토글 화면(/admin/widget-visibility)이 다루는 위젯 = 현행 노출 9종
// (CANVAS_ORDER 순서). 옛 숨김 3종(moderator/topline/slidegen)은 제외 —
// 되살리기는 코드 소관이라 토글 화면엔 미노출. widget_visibility DB 행/시드도
// 이 9종이 의미 대상 (legacy 3 은 코드 false 로 이미 고정).
export const TOGGLEABLE_WIDGET_KEYS: readonly CanvasWidgetKey[] = CANVAS_ORDER.filter(
  (k) => k !== 'moderator' && k !== 'topline' && k !== 'slidegen',
);

// 순수 해석 함수 — DB 플래그 맵(부분적일 수 있음)을 코드 기본값 위에 override.
// 슈퍼어드민은 전 위젯 true(캔버스에서 항상 다 봄). server/client 양쪽에서
// 재사용 가능하도록 side-effect 없이 유지. 반환 shape:
//   - visible: 뷰어에게 적용될 per-widget 노출 (legacy 3 은 항상 코드값=false)
//   - hiddenForNormal: 일반 유저에게 off 인 토글 위젯 키(슈퍼어드민 "숨김" 뱃지용)
export type ResolvedCanvasVisibility = {
  visible: Record<CanvasWidgetKey, boolean>;
  hiddenForNormal: CanvasWidgetKey[];
  isSuperAdmin: boolean;
};

export function resolveCanvasVisibility(
  dbFlags: Partial<Record<CanvasWidgetKey, boolean>>,
  isSuperAdmin: boolean,
): ResolvedCanvasVisibility {
  // 일반 유저 기준 effective 노출 = 코드 기본값 ⊕ DB override.
  const normal = { ...CANVAS_VISIBILITY };
  for (const k of CANVAS_ORDER) {
    const flag = dbFlags[k];
    if (typeof flag === 'boolean') normal[k] = flag;
  }
  // 토글 위젯 중 일반 유저에게 off 인 것 = 슈퍼어드민 "숨김" 뱃지 대상.
  const hiddenForNormal = TOGGLEABLE_WIDGET_KEYS.filter((k) => !normal[k]);

  if (!isSuperAdmin) {
    return { visible: normal, hiddenForNormal: [], isSuperAdmin: false };
  }
  // 슈퍼어드민: 토글 위젯 9종은 전부 true(항상 노출). legacy 3 은 코드값 유지.
  const superVisible = { ...normal };
  for (const k of TOGGLEABLE_WIDGET_KEYS) superVisible[k] = true;
  return { visible: superVisible, hiddenForNormal, isSuperAdmin: true };
}

// 순차 배포 후순위 — 일반(비-unlimited) 계정 캔버스에서 숨기는 placeholder
// 위젯 키 (2026-07-14, card 600). 이 둘은 FeatureKey 가 아니라 캔버스 전용
// placeholder 키라 PREVIEW_FEATURES 로는 못 가린다 → 키 레벨에서 제외한다.
// canvas/page.tsx 의 visible 필터가 unlimited(관리자)는 우회하므로 관리자
// 캔버스는 9개 그대로(회귀 0). 되돌리기 = 이 세트를 비우면 즉시 노출.
export const CANVAS_NORMAL_HIDDEN: ReadonlySet<CanvasWidgetKey> =
  new Set<CanvasWidgetKey>(['guideline', 'ppt_report']);
