/* ────────────────────────────────────────────────────────────────────
   ControlBoardPanel — 6 위젯 idle 컨트롤보드 layout SSOT.

   문제: balance 5종 머지 후에도 각 위젯이 데스크를 "미러" 하는 방식이라
   gap 리듬(gap-5 vs gap-8/4)·정렬(text-center)·조건부 폭·wrapper pt 가
   px 단위로 어긋났다. 원인은 규칙이 문서에만 있고 코드에 없던 것.
   → wrapper(justify-start + 유효 상단여백 40px + px-5 pb-6 + overflow) +
   클러스터(w-full max-w-2xl, 세로 gap 고정) 를 한 컴포넌트로 박제한다.

   ⚠️  위젯은 <Field> 클러스터만 children 으로 꽂는다. wrapper/gap/정렬/폭을
   위젯이 지정할 수 없다 — 아래 상수만 SSOT. 임의 layout 클래스(max-w-*,
   justify-*, pt-* 등)를 위젯 body 에서 직접 쓰면 리뷰 reject 기준.
   허용된 변주는 prop(active / gap 열거형 / banners / unpadParent) 뿐.

   규격 (balance 확정값 = 상수):
   - idle 유효 상단 여백 40px (pt-10) · px-5 · pb-6 · overflow-y-auto
   - 클러스터 = w-full max-w-2xl, 좌정렬 고정 (text-center 금지)
   - 필드 간 gap-4 / 섹션 간 gap-6 (gap prop 열거형 — 임의 gap 금지)
   - banners 슬롯 = 클러스터 위 고정 위치 (배너/온보딩 = 필드 사이 끼임 제거)
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

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
  // active 상태 = 클러스터 제약 해제(max-w 없이 상단 고정 바). 실행 중/완료
  // 화면에서 컨트롤을 상단에 붙이는 위젯용(데스크/전사록). 기본 idle launcher.
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
  // wrapper — idle: 상단부터 시작(justify-start) + 유효 40px 상단 여백.
  //           active: 상단 고정 바(shrink-0 + border-b), 세로 채움 안 함.
  const wrapper = active
    ? 'shrink-0 overflow-y-auto border-b border-line-soft px-5 py-5'
    : 'flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto px-5 pt-10 pb-6';
  // 클러스터 폭 — idle 은 max-w-2xl 로 좌우를 채우고 중앙 정렬(items-center),
  // active 는 상단 바라 전폭.
  const clusterWidth = active ? 'w-full' : 'w-full max-w-2xl';

  return (
    <div className={cx(unpadParent && '-m-5', wrapper)}>
      {banners && (
        <div className={cx('flex flex-col gap-4', clusterWidth, active ? 'mb-4' : 'mb-6')}>
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
