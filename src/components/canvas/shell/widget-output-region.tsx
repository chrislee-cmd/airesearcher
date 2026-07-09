/* ────────────────────────────────────────────────────────────────────
   WidgetOutputRegion — 6 위젯 산출물 영역 layout SSOT (컨트롤 프레임 미러).

   ControlBoardPanel 이 컨트롤 클러스터를 프레임(px-5 + max-w-2xl 수평 중앙)에
   박제한 것과 짝을 이루는 **산출물 버전**. 컨트롤 아래 붙는 산출물/진행률 밴드가
   컨트롤과 좌측 픽셀 정렬되게 한다.

   ★ 왜 px-5 만으론 안 맞는가 (2026-07-09):
   ControlBoardPanel wrapper 는 `items-center` + 클러스터 `w-full max-w-2xl` 라
   컨트롤 콘텐츠가 프레임 안에서 **수평 중앙 정렬**된다. canvas 카드 한 장 폭은
   CELL_W=816px(expandedCols=3) 라 프레임 내부 폭(≈747px) > max-w-2xl(672px) →
   컨트롤 좌측 끝은 px-5(20px)가 아니라 중앙정렬 오프셋(≈37px)만큼 안쪽이다.
   산출물을 px-5 full-width 로 두면 컨트롤보다 ~37px 왼쪽으로 튀어나온다
   (인터뷰 "핵심 요약" 회귀 root cause). 따라서 산출물도 컨트롤과 **동일한 컬럼**
   (수평 inset + max-w-2xl 중앙정렬)을 상속해야 좌측이 맞는다.

   ⚠️ 위젯은 산출물 래퍼에 px-4/px-3 나 full-width px-5 를 손코딩하지 않는다.
   이 컴포넌트만 SSOT — 수평 규격(inset + 클러스터 폭)은 여기서만 정의된다.
   허용된 변주는 prop(padY / scroll / bleed / className) 뿐. 세로 여백만 위젯이
   고른다 (정렬은 수평 문제 — 세로는 영역별 자유).

   규격:
   - 수평 inset = WIDGET_FRAME_INSET_X (px-5) — 컨트롤과 동일 SSOT
   - 콘텐츠 컬럼 = WIDGET_FRAME_CLUSTER_W (w-full max-w-2xl) 수평 중앙 — 컨트롤 클러스터와 동일
   - scroll(기본 true) = min-h-0 flex-1 overflow-y-auto (컨트롤 아래 채우는 산출물).
     false = shrink-0 (진행률/상태 밴드처럼 자연 높이 고정 바)
   - bleed(기본 false) = 클러스터 컬럼 없이 full-width. 넓은 테이블/스프레드시트/
     스트림처럼 정렬 대상이 아니고 가로 폭을 다 써야 하는 산출물용 escape hatch.
   - className = border-t 등 region 레벨 장식 (border 는 full-width 유지, 안쪽
     콘텐츠만 클러스터로 정렬 → "전폭 divider + 중앙 콘텐츠" 밴드 패턴)
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import {
  WIDGET_FRAME_INSET_X,
  WIDGET_FRAME_CLUSTER_W,
} from './control-board-panel';

// 세로 여백 — 임의 py 금지, 이 열거형만 허용 (수평은 SSOT 고정).
//   none = 없음 · sm = py-3 · md = py-4 · lg = py-5
type OutputPadY = 'none' | 'sm' | 'md' | 'lg';

const PAD_Y_CLASS: Record<OutputPadY, string> = {
  none: '',
  sm: 'py-3',
  md: 'py-4',
  lg: 'py-5',
};

type WidgetOutputRegionProps = {
  children: ReactNode;
  // 세로 여백 열거형 (기본 sm=py-3). 수평 inset 은 prop 으로 못 바꾼다 — SSOT.
  padY?: OutputPadY;
  // true(기본) = 컨트롤 아래를 채우는 스크롤 산출물(min-h-0 flex-1 overflow-y-auto).
  // false = 진행률/상태 밴드처럼 자연 높이 고정 바(shrink-0).
  scroll?: boolean;
  // true = 클러스터 컬럼 없이 full-width (넓은 테이블/스트림 등 정렬 대상 아닌 산출물).
  bleed?: boolean;
  // region 레벨 추가 클래스 (border-t 등). border 는 full-width, 콘텐츠는 클러스터 정렬.
  className?: string;
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function WidgetOutputRegion({
  children,
  padY = 'sm',
  scroll = true,
  bleed = false,
  className,
}: WidgetOutputRegionProps) {
  return (
    <div
      className={cx(
        'flex flex-col',
        scroll ? 'min-h-0 flex-1 overflow-y-auto' : 'shrink-0',
        // bleed 가 아니면 클러스터 컬럼을 수평 중앙 정렬 (컨트롤과 동일).
        !bleed && 'items-center',
        WIDGET_FRAME_INSET_X,
        PAD_Y_CLASS[padY],
        className,
      )}
    >
      {bleed ? (
        children
      ) : (
        <div className={WIDGET_FRAME_CLUSTER_W}>{children}</div>
      )}
    </div>
  );
}

export type { WidgetOutputRegionProps, OutputPadY };
