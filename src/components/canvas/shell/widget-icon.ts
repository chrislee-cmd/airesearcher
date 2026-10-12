/* ────────────────────────────────────────────────────────────────────
   위젯 key → 듀오톤 아이콘 (Soft Identity 리브랜드 1단계).

   왜 생겼나: Soft 변환표에서 카드 헤더 띠가 **원색 파스텔 → 틴트**로 바뀌면서
   (핵심규칙 3 "원색은 작은 면에만"), 위젯 원색은 헤더 왼쪽 **40 아이콘 타일**이
   들고 간다. 타일 글리프를 고를 데이터가 `WidgetContent.meta` 에 없어서 셸이
   key 로 해석한다.

   글리프 선택 근거: CD 가 "레포의 `iconography-duotone` 세트를 그대로 쓰고,
   컴프 속 아이콘은 자리표시"라고 명시(design-handoff/soft-identity/README.md
   Assets) — 즉 글리프 선정은 레포 세트 안에서 워커 몫이다. 아래 7종은 세트에
   이미 있는 이름 중 의미가 1:1 인 것만 골랐다(창작 0):
     translate  → interpret   (라이브 통역 — 세트 이름 그대로)
     quotes     → transcribe  (전사록 생성기 — 파형, 세트 이름 그대로)
     desk       → search      (데스크 리서치)
     recruiting → guest       (참가자 모집)
     probing    → questions   (인터뷰 어시스턴트 = 질문 심화)
     interviews → document    (인터뷰 결과 보고서)
     moderator_ai → observe   (AI UT = 관찰)

   미등재 key(준비중·숨김 위젯)는 중립 `document` 폴백 — 타일이 비지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import type { DuotoneIconName } from '@/components/ui/icons/duotone-icon';

const WIDGET_ICON: Record<string, DuotoneIconName> = {
  translate: 'interpret',
  quotes: 'transcribe',
  desk: 'search',
  recruiting: 'guest',
  probing: 'questions',
  interviews: 'document',
  moderator_ai: 'observe',
};

export function widgetIconFor(widgetKey: string): DuotoneIconName {
  return WIDGET_ICON[widgetKey] ?? 'document';
}
