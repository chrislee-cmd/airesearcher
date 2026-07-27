/* ────────────────────────────────────────────────────────────────────
   Picker system — 공용 타입 (BUILD-SPEC `design-handoff/picker-system/`).

   하나의 컴포넌트 패밀리가 제품 전역의 dropdown/select/sort/filter 를 담당
   한다(위젯 카드·풀뷰·모달·공개 페이지). 리크루팅 리스트 컨트롤(597)에서
   일반화. 시각 SSOT = `Picker System.dc.html`.
   ──────────────────────────────────────────────────────────────────── */

/** 트리거 사이즈 — md(34px, 풀뷰 툴바/테이블/모달) · sm(28px, 위젯 레일/사이드). */
export type PickerSize = 'md' | 'sm';

/** 선택 옵션 한 개(P1 라디오 · P2/P3 체크박스 행). */
export type PickerOption = {
  /** 값 식별자(선택 상태 매칭 키). */
  value: string;
  /** 화면 라벨. 길면 truncate(줄바꿈 금지). */
  label: string;
  /**
   * 값별 카운트 — optional(G5). 클라 데이터셋일 때만. 없으면 카운트 열 미표시,
   * 있으면 우측 정렬 mono. 카운트 유무로 레이아웃이 흔들리면 안 된다.
   */
  count?: number;
};

/** P3 좌측 pane 의 필드(부모) 한 개 — 질문/컬럼/카테고리/언어그룹. */
export type PickerField = {
  id: string;
  label: string;
  /** 이 필드에 적용된 선택 수 — >0 이면 amore 배지 노출. */
  appliedCount?: number;
};

/** 패널 데이터 로딩 상태(edge states §4). */
export type PickerPanelStatus = 'ready' | 'loading' | 'error';
