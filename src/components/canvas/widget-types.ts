/* ────────────────────────────────────────────────────────────────────
   Canvas widget — SSOT 타입.
   셸과 컨텐츠 모듈의 계약. PR1 placeholder 시점에서는 ExpandedBody 가
   안내 텍스트 + skeleton 만 그림. PR2 에서 도구별 실제 본문 (FileDropZone
   / 잡 리스트 등) 이 ExpandedBody 로 합쳐짐.
   ──────────────────────────────────────────────────────────────────── */

import type { FC } from 'react';

// Live state pushed by widget bodies through WidgetStateContext. `running`
// optionally carries a 0-100 progress and a short uppercase label that the
// header pill renders inline (e.g. "TRANSCRIBING 72%"). Realtime widgets
// (no measurable progress) omit `progress` and the pill shows the label
// alone. Frontend-only widgets never push state and stay at the initial
// `idle` value derived from `content.state`.
//
// `progress` is the *per-phase* number that the widget's own header pill
// renders (e.g. crawl 47/240 → 19% inside the crawling phase). `overallProgress`
// is the optional *cumulative* number (0~100 across all phases) that the
// Canvas Navigator shows next to the widget row. Producers fill both when
// they can map phases to a global timeline (see `src/lib/widget-progress.ts`).
export type WidgetStateInfo =
  | { kind: 'idle' }
  | {
      kind: 'running';
      progress?: number;
      label?: string;
      overallProgress?: number;
    }
  | { kind: 'done' }
  | { kind: 'error'; message?: string };

export type WidgetState = WidgetStateInfo['kind'];

export type AccentColor = 'sky' | 'peach' | 'mint' | 'lav' | 'sun' | 'rose' | 'cyan';

export type WidgetContent = {
  key: string;
  meta: {
    // 표시 라벨. `labelKey` 가 있으면 i18n 해석값이 우선하지만, label 은
    // "무시"가 아니라 **해석 실패 시 폴백**이다 (resolveWidgetLabel 참고).
    // labelKey 만 두고 label 을 비우면, 어떤 이유로든 labelKey 미해석 시
    // 셸/사이드바가 완전 blank 로 렌더된다 (#1051 회귀). labelKey 를 쓰는
    // 위젯은 반드시 폴백 label(영문 기본)을 함께 둘 것.
    label?: string;
    // 옵션: label 대신 messages 키(full path, 예: 'Features.quotes.title')로
    // 헤더/사이드바 라벨을 i18n. 지정 시 셸/사이드바가 t(labelKey) 로 해석해
    // localized 라벨을 우선 노출하고, 해석 실패 시 label 로 폴백한다.
    labelKey?: string;
    accent: AccentColor;
    // 옵션(opt-in): 'v3' 면 canvas-board 가 이 위젯을 WIDGET-SHELL Frame spec
    // 셸(widget-shell-v3 — radius 20·3px border·cyan 헤더·단일 툴바 pill·ink
    // CTA)로 렌더한다. 미지정 위젯은 기존 production 셸(140px 밴드) 그대로 —
    // 크로스위젯 회귀 0. greenfield v3 위젯(Desk·recruiting)이 공유 (통합 SSOT
    // #1114, AUTHORITY §D fresh 신규 빌드). 헤더 파스텔은 accent(cyan)로 결정.
    frame?: 'v3';
    cost?: number;
    // 옵션: cost 의 1-line 표기를 통째로 override. 일반 위젯은 cost 만
    // 두면 셸이 "N 크레딧" / "무료" 자동 그림. 단일 숫자로 표현이 어려운
    // 라이프사이클 차감 (시간당 추가 등) 도 기본은 lump 숫자 + /credits
    // 페이지의 Features.{key}.cost 라벨로 detail 을 전달 — 헤더는 다른
    // 위젯과 시각 통일 위해 보통 cost 만 쓴다. 정말 헤더에 한 줄 별도
    // 표기가 필요한 경우만 이 필드로 override. 두 필드가 모두 있으면
    // costLabel 우선.
    costLabel?: string;
    // 옵션: `/public` 아래 썸네일 경로. 지정 시 widget-shell 이 accent 박스
    // 대신 next/image 로 렌더 (PR #352 의 deskresearch.png 패턴).
    thumbnail?: string;
    // 옵션: 헤더 타이틀 아래 부제 1줄 (line-clamp-1). messages 의
    // Features.{key}.description 과 일관성 유지.
    description?: string;
    // 옵션: expand 시 셀 몇 개 너비로 확장할지. 미지정 = 2.
    // 1: collapsed 와 동일 너비 (240) — vertical 만 확장
    // 2: 두 셀 너비 (528 = 240 + 48 + 240) — 일반 도구
    // 3: 세 셀 너비 (816 = 240 + 48 + 240 + 48 + 240) — 전사록/데스크
    //    처럼 가로 정보 밀도 높은 본문
    expandedCols?: 1 | 2 | 3;
    // 옵션: 위젯이 차지하는 row 수. 미지정 = 1.
    // 1: 한 셀 높이 (800)
    // 2: 두 셀 높이 (1648 = 800 + 48 + 800)
    // 3: 세 셀 높이 (2496 = 800 + 48 + 800 + 48 + 800) — autocontents
    //    같이 본문 분량이 많은 도구
    expandedRows?: 1 | 2 | 3;
  };
  state: WidgetState;
  ExpandedBody: FC;
  // 옵션: "준비 중" placeholder 위젯을 dim 처리 (opacity-50). 헤더·본문
  // 전체를 반투명 처리해 옛 실기능 위젯과 시각 구분 (canvas-board 가 셸
  // wrapper 에 적용). 클릭은 살아 있다 — "전체 보기" 로 기능 소개 hero
  // (ComingSoonBody) 진입 가능. 실 backend 가 붙어 활성화될 때는 이
  // 플래그만 제거하면 즉시 정상 렌더.
  dimmed?: boolean;
};

// next-intl 의 `useTranslations()`(루트) 반환의 최소 구조 계약.
// dotted full-path 를 받는 호출 시그니처 + `.has()` 존재 확인만 쓴다.
type LabelTranslator = {
  (key: string): string;
  has(key: string): boolean;
};

/**
 * 위젯 표시 라벨 해석 — 셸(헤더)·사이드바 nav·준비중 게이트가 공유하는 SSOT.
 *
 * 규칙: `labelKey` 가 있고 **실제로 해석되면** localized 값을 우선 노출,
 * 아니면 하드코드 `label`(영문 폴백)로 내려간다. `t.has()` 로 먼저 존재를
 * 확인하므로, 미해석 시 next-intl 의 getMessageFallback('')(request.ts) 이
 * 반환하는 빈 문자열이 라벨 자리에 새어 blank 로 렌더되는 일을 원천 차단한다.
 * 해석값이 (예상 밖으로) 빈 문자열이어도 label 로 폴백 — blank 불가.
 *
 * 배경(#1051 회귀): keep-4 카드가 하드코드 label 을 지우고 labelKey 만 남긴 뒤,
 * labelKey 미해석 상황에서 폴백이 없어 fullview nav·헤더 라벨이 전부 blank 였다.
 */
export function resolveWidgetLabel(
  t: LabelTranslator,
  meta: Pick<WidgetContent['meta'], 'label' | 'labelKey'>,
): string {
  const { labelKey, label } = meta;
  if (labelKey && t.has(labelKey)) {
    const resolved = t(labelKey);
    if (resolved) return resolved;
  }
  return label ?? '';
}
