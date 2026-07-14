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
   허용된 변주는 prop(active / gap 열거형 / banners) 뿐.

   규격 (balance 확정값 = 상수, idle=active 동일):
   - 유효 상단 여백 40px (pt-10) · px-5 · pb-6 · overflow-y-auto
   - 클러스터 = w-full max-w-2xl, 좌정렬 고정 (text-center 금지)
   - 필드 간 gap-4 / 섹션 간 gap-6 (gap prop 열거형 — 임의 gap 금지)
   - banners 슬롯 = 클러스터 위 고정 위치 (배너/온보딩 = 필드 사이 끼임 제거)
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Field } from './field';

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

// 드롭다운 행(.Settings) 자식 간 간격 SSOT — 프레임 상수(px-5 / pt-10 pb-6 /
// field=gap-4 / section=gap-6) 와 같은 층위의 잠금값. 위젯이 설정 행을
// <div className="flex flex-wrap gap-4"> 로 손코딩하지 않고 .Settings 슬롯을
// 거치게 해 4개 위젯의 드롭다운 간 간격이 px 단위로 일치한다.
//   값 = gap-4(16px). spec 은 gap-3 을 제안했으나 그 근거("기존 리듬에 맞춰")와
//   상충 — 실측 기존 리듬(probing/quotes/translate 설정 행) + quotes-card-body 의
//   2026-07-14 사용자 결정 주석("gap-4(16px) 로 통일")이 모두 gap-4 라, 무회귀
//   보수적 해석으로 기존 통일값을 형식화한다. 값 변경 시 이 한 줄만 고치면 4개
//   위젯 전체 반영.
export const SETTINGS_ROW_GAP = 'gap-4';

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
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function ControlBoardPanel({
  children,
  banners,
  active = false,
  gap = 'none',
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
    <div className={wrapper} data-ds-primitive="ControlBoardPanel">
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

/* ── named 슬롯 계약 ──────────────────────────────────────────────────
   ControlBoardPanel 의 cluster children 로 꽂는 세로 슬롯 4종. "슬롯의 바깥
   규격(드롭다운 간 gap / 정렬 / 슬롯 자체 여백)은 SSOT 로 잠그고, 슬롯을 채우는
   콘텐츠만 위젯 자유" — 사용자 원칙(2026-07-14). 슬롯 간 세로 리듬은 cluster
   gap(prop) 이 소유하므로 슬롯은 자체 mt-/mb-/space-y- 를 두지 않는다. 위젯이
   설정 행/입력/CTA 를 손코딩하지 않고 이 슬롯만 조합하게 해 픽셀 drift 를 막는다
   (재발 방지 lint 가드 = eslint.config.mjs 의 control-frame 셀렉터).
   ──────────────────────────────────────────────────────────────────── */

type SlotProps = {
  children: ReactNode;
  // 상태 신호용(opacity/pointer-events 등) — layout 유틸은 넣지 말 것.
  // 프레임/간격은 슬롯이 소유하므로 여기로 max-w-*/justify-*/gap-* 를 주입하면
  // 슬롯 계약이 무의미해진다.
  className?: string;
};

type LabeledSlotProps = SlotProps & {
  // 주면 Field 로 래핑(라벨↔컨트롤 간격 = Field mb-1.5 SSOT), 없으면 passthrough.
  label?: string;
  description?: ReactNode;
  required?: boolean;
  htmlFor?: string;
};

// .Settings — 드롭다운/토글/체크박스가 한 줄로 앉는 행. 자식 간 간격 =
// SETTINGS_ROW_GAP SSOT, items-end 로 라벨 높이가 달라도 컨트롤 baseline 정렬.
// 위젯은 <Field>+SelectMenu/ControlTrigger 만 자식으로.
function SettingsSlot({ children, className }: SlotProps) {
  return (
    <div
      data-ds-slot="settings"
      className={cx('flex flex-wrap items-end', SETTINGS_ROW_GAP, className)}
    >
      {children}
    </div>
  );
}

// .Input — 메인 입력(textarea/dropzone/chip). label 주면 Field 래핑, 없으면
// passthrough. 슬롯 자체 여백 없음(슬롯 간 리듬은 cluster gap 이 담당).
function InputSlot({
  label,
  description,
  required,
  htmlFor,
  children,
  className,
}: LabeledSlotProps) {
  const inner = label ? (
    <Field
      label={label}
      description={description}
      required={required}
      htmlFor={htmlFor}
    >
      {children}
    </Field>
  ) : (
    children
  );
  return (
    <div data-ds-slot="input" className={className}>
      {inner}
    </div>
  );
}

// .Region — "규격 프레임 + 콘텐츠 자유". 선택적 라벨(Field) + 임의 children
// (페르소나 그리드·리스트 등). 바깥 규격(cluster 폭 상속 + 슬롯 간 리듬)만 고정,
// 안은 위젯 자유. 0~n개 배치 가능. 구조는 .Input 과 같고 의미(자유 콘텐츠)만 다름.
function RegionSlot({
  label,
  description,
  required,
  htmlFor,
  children,
  className,
}: LabeledSlotProps) {
  const inner = label ? (
    <Field
      label={label}
      description={description}
      required={required}
      htmlFor={htmlFor}
    >
      {children}
    </Field>
  ) : (
    children
  );
  return (
    <div data-ds-slot="region" className={className}>
      {inner}
    </div>
  );
}

type ActionAlign = 'end' | 'between';

// .Action — 핵심 CTA. 정렬 SSOT: 기본 우측(justify-end), between=양끝(상태/타이머
// 좌 + 버튼 우). full=버튼이 폭 채움(flex-col stretch — 단일 primary CTA 용).
// 자식 간 gap = SETTINGS_ROW_GAP. 위젯은 Button/ChromeButton 만.
function ActionSlot({
  children,
  align = 'end',
  full = false,
  className,
}: SlotProps & { align?: ActionAlign; full?: boolean }) {
  if (full) {
    return (
      <div data-ds-slot="action" className={cx('flex flex-col', className)}>
        {children}
      </div>
    );
  }
  return (
    <div
      data-ds-slot="action"
      className={cx(
        'flex flex-wrap items-center',
        SETTINGS_ROW_GAP,
        align === 'between' ? 'justify-between' : 'justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}

// compound component — 위젯은 ControlBoardPanel.Settings/.Input/.Region/.Action
// 로만 슬롯을 조합한다.
ControlBoardPanel.Settings = SettingsSlot;
ControlBoardPanel.Input = InputSlot;
ControlBoardPanel.Region = RegionSlot;
ControlBoardPanel.Action = ActionSlot;

export type { ControlBoardPanelProps, ClusterGap };
