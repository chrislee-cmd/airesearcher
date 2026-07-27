/* ────────────────────────────────────────────────────────────────────
   Picker 패널 포지셔닝 (G1).

   portal 패널을 트리거(앵커) 아래-좌에 배치한다. 뷰포트 하단 여유가
   부족하면(12px 이내) 위로 flip. max-height 를 가용 공간으로 clamp 하고
   내부 스크롤에 맡긴다. 좌측은 우측 오버플로 시 뷰포트 안으로 clamp.

   값 SSOT: 세로 gap 4px · 좌우 margin 8px 는 597 리크루팅 구현과 동일(픽셀
   동일 보존). 뷰포트 상단/하단 안전 여백 12px = BUILD-SPEC G1 "within 12px".
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from 'react';

const GAP = 4; // 트리거와 패널 사이 세로 간격 (597 동일)
const MARGIN = 8; // 좌우 뷰포트 여백 (597 동일)
const EDGE = 12; // flip 판정 · 상하 안전 여백 (G1 "12px")

export type PickerPanelStyle = CSSProperties & {
  /** 'below' = 아래로 열림 · 'above' = flip-up. 애니메이션 원점 등에 활용 가능. */
  ['--picker-placement']?: string;
};

/**
 * @param anchorRect  측정된 트리거 DOMRect (usePopoverBase.anchorRect)
 * @param width       패널 폭(px)
 * @param preferredHeight  패널 선호 높이(px). 주면 height = min(preferred, 가용);
 *                         안 주면 height 미설정(콘텐츠 높이) + maxHeight 만 clamp.
 */
export function computePanelStyle(
  anchorRect: DOMRect,
  width: number,
  preferredHeight?: number,
): PickerPanelStyle {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 좌: 앵커 left 기준, 우측 오버플로 시 좌로 clamp.
  const maxLeft = vw - width - MARGIN;
  const left = Math.max(MARGIN, Math.min(anchorRect.left, maxLeft));

  // 상/하 가용 공간.
  const spaceBelow = vh - anchorRect.bottom - GAP - EDGE;
  const spaceAbove = anchorRect.top - GAP - EDGE;

  // 선호 높이(없으면 아래 공간 선호값)를 기준으로 flip 판정: 아래가 부족하고
  // 위가 더 넓으면 flip-up.
  const need = preferredHeight ?? Math.min(spaceBelow, 320);
  const flipUp = spaceBelow < need && spaceAbove > spaceBelow;

  const avail = Math.max(120, flipUp ? spaceAbove : spaceBelow);
  const height =
    preferredHeight != null ? Math.min(preferredHeight, avail) : undefined;

  const base: PickerPanelStyle = {
    position: 'fixed',
    left,
    width,
    maxHeight: avail,
    '--picker-placement': flipUp ? 'above' : 'below',
  };
  if (height != null) base.height = height;

  if (flipUp) {
    base.bottom = vh - anchorRect.top + GAP;
  } else {
    base.top = anchorRect.bottom + GAP;
  }
  return base;
}
