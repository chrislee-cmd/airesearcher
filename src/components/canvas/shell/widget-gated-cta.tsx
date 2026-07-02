/* ────────────────────────────────────────────────────────────────────
   WidgetGatedCTA — 서브헤더 우측 메인 CTA (검색 / 통역시작 / 세션시작 등) 를
   감싸, "왜 지금 못 누르는지" 를 CTA 바로 아래 한 줄 hint 로 드러내는 wrapper.

   CTA 버튼 자체(ChromeButton) 는 호출부가 children 으로 넘긴다 — 위젯마다
   label / variant / live·stop 분기가 달라 버튼 소유를 강제하지 않는 편이
   회귀 위험이 적다. 이 primitive 는 오직 "hint row 추가" 만 책임진다.

   showHint=true 일 때만 reasonHint 를 노출한다 (보통 disabled 사유가
   "설정/업로드 미완료" 일 때. busy/진행중 disabled 는 loading 라벨이 이미
   맥락을 주므로 hint 를 띄우지 않는다).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

export type WidgetGatedCTAProps = {
  // CTA 버튼(들). ChromeButton 등.
  children: ReactNode;
  // "⚙ 설정을 먼저 완료해 주세요" 같은 미완료 사유.
  reasonHint?: string;
  // reasonHint 노출 여부 (설정/업로드 미완료 상태).
  showHint?: boolean;
};

export function WidgetGatedCTA({
  children,
  reasonHint,
  showHint = false,
}: WidgetGatedCTAProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      {children}
      {showHint && reasonHint && (
        <span className="whitespace-nowrap text-xs-soft text-mute-soft">
          {reasonHint}
        </span>
      )}
    </div>
  );
}
