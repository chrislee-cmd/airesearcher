/* ────────────────────────────────────────────────────────────────────
   ControlBoardPanel — 6 위젯 컨트롤보드 layout SSOT (상태 불변 프레임).

   문제: balance 5종 머지 후에도 각 위젯이 데스크를 "미러" 하는 방식이라
   gap 리듬(gap-5 vs gap-8/4)·정렬(text-center)·조건부 폭·wrapper pt 가
   px 단위로 어긋났다. 원인은 규칙이 문서에만 있고 코드에 없던 것.
   → wrapper(justify-start + 유효 상단여백 40px + px-5 pb-6 + overflow) +
   클러스터(w-full max-w-2xl, 세로 gap 고정) 를 한 컴포넌트로 박제한다.

   ★ 상태 불변 프레임 (2026-07-09):
   "잘 설계된 위젯은 상태(idle/active)가 달라진다고 프레임 규격이 바뀌면
   안 된다 — 언제나 고정 프레임 안에서 동적 부분만 반응한다" (사용자 원칙).
   그래서 wrapper 의 외곽 padding/폭/정렬은 active 무관 고정이다:
   px-5 pt-10 pb-6(40/20/24) · 상단정렬(justify-start) · items-center ·
   클러스터 w-full max-w-2xl 수평 중앙 — idle 과 active 가 픽셀 동일.
   active 가 바꾸는 것은 프레임이 아니라 (1) 세로 채움 정책(idle=flex-1 로
   카드를 채우고, active=shrink-0 상단 바 + 아래 산출물이 flex-1) 과
   (2) 컨트롤/산출물 사이 divider(border-b) — 둘 다 컨트롤 위치를 안 움직인다
   (justify-start 라 flex-1↔shrink-0 전환에도 컨트롤은 상단 제자리).

   ⚠️  위젯은 <Field> 클러스터만 children 으로 꽂는다. wrapper/gap/정렬/폭을
   위젯이 지정할 수 없다 — 아래 상수만 SSOT. 임의 layout 클래스(max-w-*,
   justify-*, pt-* 등)를 위젯 body 에서 직접 쓰면 리뷰 reject 기준.
   허용된 변주는 prop(active / gap 열거형 / banners / unpadParent) 뿐.

   규격 (balance 확정값 = 상수, idle=active 동일):
   - 유효 상단 여백 40px (pt-10) · px-5 · pb-6 · overflow-y-auto
   - 클러스터 = w-full max-w-2xl, 좌정렬 고정 (text-center 금지)
   - 필드 간 gap-4 / 섹션 간 gap-6 (gap prop 열거형 — 임의 gap 금지)
   - banners 슬롯 = 클러스터 위 고정 위치 (배너/온보딩 = 필드 사이 끼임 제거)
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

// 위젯 프레임 수평 inset SSOT — 컨트롤 클러스터와 산출물 영역이 공유하는 단일
// 좌우 여백. 컨트롤(ControlBoardPanel wrapper)과 그 아래 형제 산출물 영역·진행률
// 밴드가 이 한 상수를 상속해 좌측 픽셀이 정렬된다. 위젯 body 가 산출물 래퍼에
// px-4/px-3 를 손코딩하면 컨트롤↔산출물이 4px 어긋난다(인터뷰 "핵심 요약" 회귀
// 사례) — 산출물 영역 수평 여백은 반드시 이 상수만 참조한다. 세로 여백은 영역별
// 자유(정렬은 수평 문제).
export const WIDGET_FRAME_INSET_X = 'px-5';

// 위젯 프레임 콘텐츠 컬럼 폭 SSOT — 컨트롤 클러스터가 이 폭(max-w-2xl)으로
// 좌우를 채우고 프레임 안에서 **수평 중앙 정렬**된다. 카드 body 는 CELL_W=816px
// (expandedCols=3) 라 프레임 내부 폭이 max-w-2xl(672px)보다 넓어서, 컨트롤은
// px-5 가 아니라 중앙 정렬 오프셋(≈37px)만큼 안쪽에서 시작한다. 따라서 산출물이
// 컨트롤과 좌측 정렬되려면 px-5 만으로 부족하고 — 산출물도 동일한 컬럼(중앙 정렬
// max-w-2xl)을 공유해야 한다. 산출물 영역을 `flex flex-col items-center` +
// 자식 `WIDGET_FRAME_CLUSTER_W` 로 감싸면 컨트롤 클러스터와 좌측 픽셀이 일치한다.
export const WIDGET_FRAME_CLUSTER_W = 'w-full max-w-2xl';

// 클러스터 세로 간격 — 임의 gap 금지, 이 열거형만 허용.
//   none    = 간격 없음 (단일 자식 클러스터: 데스크/프로빙/전사록)
//   field   = gap-4  (필드 간 리듬)
//   section = gap-6  (섹션 간 리듬: 컨트롤 그룹 + CTA 등)
type ClusterGap = 'none' | 'field' | 'section';

const GAP_CLASS: Record<ClusterGap, string> = {
  none: '',
  field: 'gap-4',
  section: 'gap-6',
};

type ControlBoardPanelProps = {
  // Field 클러스터. 폭/정렬/간격은 이 컴포넌트가 강제 — 위젯이 못 정한다.
  children: ReactNode;
  // 배너/온보딩 슬롯 — 클러스터와 분리된 고정 위치(클러스터 위). 필드 사이
  // 끼임 제거용. 없으면 렌더 안 함.
  banners?: ReactNode;
  // active 상태 = 산출물이 아래에 붙는 위젯용(데스크/전사록/통역/프로빙 등).
  //   프레임(외곽 padding/폭/정렬) 은 idle 과 동일 — active 는 세로 채움
  //   정책(shrink-0 상단 바 + 산출물 flex-1)과 divider(border-b) 만 바꾼다.
  //   기본 idle launcher (flex-1 로 카드를 채우고 상단정렬).
  active?: boolean;
  // 클러스터 세로 간격 열거형 (위 ClusterGap 주석 참고). 기본 none.
  gap?: ClusterGap;
  // 부모가 이미 p-5 패딩을 주는 경우(통역-card 의 px-5 py-5) 그 이중 패딩을
  // -m-5 로 상쇄해 유효 40px/px-5 를 이 컴포넌트가 그대로 흡수한다. layout
  // 값 자체는 여전히 이 컴포넌트 상수 — 위젯은 "부모가 패딩을 준다"는
  // 구조 사실만 선언한다.
  unpadParent?: boolean;
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function ControlBoardPanel({
  children,
  banners,
  active = false,
  gap = 'none',
  unpadParent = false,
}: ControlBoardPanelProps) {
  // wrapper — 외곽 padding/폭/정렬은 상태 불변(px-5 pt-10 pb-6 + 상단정렬 +
  // 수평 중앙). active 는 세로 채움 정책만 바꾼다:
  //   idle   = flex-1  (카드를 채우고 컨트롤은 상단정렬, 아래는 빈 공간)
  //   active = shrink-0 + border-b (자연 높이 상단 바; 산출물은 형제 flex-1)
  // justify-start 라 flex-1↔shrink-0 전환에도 컨트롤은 상단 제자리 = 안 튐.
  const wrapper = cx(
    'flex min-h-0 flex-col items-center justify-start overflow-y-auto pt-10 pb-6',
    WIDGET_FRAME_INSET_X,
    active ? 'shrink-0 border-b border-line-soft' : 'flex-1',
  );
  // 클러스터 폭 — idle=active 동일. max-w-2xl 로 좌우를 채우고 수평 중앙.
  // 산출물 영역이 동일 상수를 상속해 컨트롤↔산출물 좌측 정렬 (WIDGET_FRAME_CLUSTER_W).
  const clusterWidth = WIDGET_FRAME_CLUSTER_W;

  return (
    <div className={cx(unpadParent && '-m-5', wrapper)}>
      {banners && (
        <div className={cx('flex flex-col gap-4', clusterWidth, 'mb-6')}>
          {banners}
        </div>
      )}
      <div className={cx('flex flex-col', clusterWidth, GAP_CLASS[gap])}>
        {children}
      </div>
    </div>
  );
}

export type { ControlBoardPanelProps, ClusterGap };
