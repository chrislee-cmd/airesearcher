'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetAccordion — 위젯 세팅 "유스케이스 4-스텝" 가이드 아코디언 (공유 셸).

   배경 (V2 세팅 개편 PR-B): probing / interpreter 두 위젯의 setup(idle)
   컨트롤이 "스펙 단위 평면 리스트"(프로젝트/캡처/언어/목적|용어)로 한꺼번에
   노출됐다. 이를 유스케이스 순서(프로젝트 → 인터뷰 방식 → 언어 → 질문|용어)의
   4-스텝 아코디언으로 재구성해, 한 번에 한 스텝만 펼쳐 사용자를 안내한다.

   3-상태 (프로토 D3 규격 → 전부 토큰):
     - active (펼침)  = border-ink(2px) + shadow-memphis-md + rounded-sm,
                        번호배지 bg-ink/text-paper. 바디 = 컨트롤.
     - done (요약접힘) = bg-mint + border-line-soft, ✓ 배지 bg-success,
                        eyebrow(STEP 0N · 제목) + 값 요약 + "변경" 링크.
     - todo (접힘)    = border-line + text-mute-soft, 배지 bg-line-soft.

   인터랙션:
     - 한 번에 한 스텝만 active. 완료 시 호출부가 다음 스텝을 auto-open.
     - done/todo 카드 클릭 → 재오픈 (onOpen).
     - 빈영역(스텝 사이 gap) 클릭 → 전체 컬랩스 (target===currentTarget 가드).
     - 긴 리스트(질문/언어)는 스텝 바디 내부에서 스크롤 (호출부가 max-h + overflow).

   ⚠️ 라이브 회귀 0: 이 셸은 idle/setup 만 감싼다. 라이브 표면(프롬프터/페르소나/
   종료/공유)은 각 위젯이 그대로 렌더 — 아코디언 밖.

   토큰만: 색/모서리/그림자 전부 tokens.json 어휘 (design-system 가드 준수).
   proposed 토큰(success-bg/line, surface-disabled)은 토큰 트랙 라벨 전이라
   기존 토큰(bg-mint / border-line-soft / bg-success / border-ink)으로 대체.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type ReactNode } from 'react';

export type AccordionStepState = 'active' | 'done' | 'todo';

// 한 스텝의 선언적 구성. 상태(active/done/todo)는 호출부가 계산해 넘긴다
// (완료 여부·현재 active index 는 위젯 state 소유).
export type AccordionStepConfig = {
  // 안정 key (React list) + 접근성 id 접두.
  key: string;
  // 접힌 카드 eyebrow (예: "STEP 01 · 프로젝트"). done 상태에서 값 위에 노출.
  eyebrow: string;
  // active/todo 제목 (예: "작업중인 프로젝트를 선택해주세요" / "프로젝트").
  title: string;
  // done 상태에서 노출할 값 요약 (예: 프로젝트명 / "한국어 → English").
  summary?: ReactNode;
  // 선택 스텝 표식 (예: interpreter 용어집). title 옆 "(선택)" 렌더.
  optional?: boolean;
  // active 상태 바디 (컨트롤). active 일 때만 렌더.
  body: ReactNode;
};

// 아코디언 active-step 상태 훅. 완료 시 auto-open 은 호출부가 open(next) 로
// 명시 제어 (프로토와 동일 imperative). collapseAll = 빈영역 클릭.
export function useWidgetAccordion(initialActive = 0) {
  const [active, setActive] = useState(initialActive);
  return {
    active,
    // 특정 스텝 펼치기 (재오픈 / auto-advance 공용).
    open: (index: number) => setActive(index),
    // 전체 접기 (-1 = 어떤 스텝도 active 아님).
    collapseAll: () => setActive(-1),
  };
}

function StepBadge({
  state,
  label,
}: {
  state: AccordionStepState;
  label: ReactNode;
}) {
  const cls =
    state === 'active'
      ? 'bg-ink text-paper'
      : state === 'done'
        ? 'bg-success text-paper'
        : 'bg-line-soft text-mute-soft';
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cls}`}
    >
      {label}
    </span>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 6.5 5 9l4.5-5" />
    </svg>
  );
}

function AccordionStep({
  index,
  state,
  config,
  onOpen,
  changeLabel,
  optionalLabel,
}: {
  index: number;
  state: AccordionStepState;
  config: AccordionStepConfig;
  onOpen: () => void;
  // "변경" 링크 라벨 (done 상태).
  changeLabel: string;
  // "(선택)" 표식 라벨 (optional 스텝).
  optionalLabel: string;
}) {
  if (state === 'active') {
    return (
      <div className="rounded-sm border-2 border-ink bg-paper p-4 shadow-memphis-md">
        <div className="mb-3 flex items-center gap-2.5">
          <StepBadge state="active" label={index + 1} />
          <span className="text-sm font-bold text-ink">{config.title}</span>
        </div>
        {config.body}
      </div>
    );
  }

  if (state === 'done') {
    return (
      // eslint-disable-next-line react/forbid-elements -- 접힌 스텝 = 클릭 시 재오픈하는 요약 카드 (ui/ primitive 밖 셸 프리미티브 정의 지점)
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between rounded-sm border border-line-soft bg-mint px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <StepBadge state="done" label={<CheckGlyph />} />
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-mute">{config.eyebrow}</span>
            <span className="truncate text-sm font-semibold text-ink">
              {config.summary}
            </span>
          </span>
        </span>
        <span className="ml-2 shrink-0 text-xs font-medium text-mute-soft">
          {changeLabel}
        </span>
      </button>
    );
  }

  // todo
  return (
    // eslint-disable-next-line react/forbid-elements -- 접힌 스텝 = 클릭 시 재오픈하는 요약 카드 (ui/ primitive 밖 셸 프리미티브 정의 지점)
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-sm border border-line bg-paper px-4 py-3 text-left"
    >
      <span className="flex items-center gap-2.5">
        <StepBadge state="todo" label={index + 1} />
        <span className="text-sm font-semibold text-mute-soft">
          {config.title}
          {config.optional && (
            <span className="ml-1.5 text-xs font-medium">{optionalLabel}</span>
          )}
        </span>
      </span>
    </button>
  );
}

// 4-스텝 아코디언 컨테이너. active index 는 호출부(useWidgetAccordion) 소유.
// 각 스텝 상태 계산: active===index → 'active', 완료(config.complete 대체:
// summary!=null 은 호출부가 판단) → 'done', else 'todo'. 완료 판정은 호출부가
// stateFor 로 명시 (스텝별 완료 규칙이 위젯마다 다름).
export function WidgetAccordion({
  steps,
  activeIndex,
  onOpenStep,
  onCollapse,
  stateFor,
  changeLabel,
  optionalLabel,
}: {
  steps: AccordionStepConfig[];
  activeIndex: number;
  onOpenStep: (index: number) => void;
  onCollapse: () => void;
  // 각 스텝의 3-상태 계산 (active 우선, 그다음 완료 여부). 호출부 소유.
  stateFor: (index: number) => AccordionStepState;
  changeLabel: string;
  optionalLabel: string;
}) {
  return (
    <div
      // 빈영역(스텝 사이 gap / 컨테이너 패딩) 클릭 → 전체 컬랩스. 스텝 카드
      // 내부 클릭은 target!==currentTarget 이라 통과 (프로토 pCollapse 가드).
      onClick={(e) => {
        if (e.target === e.currentTarget) onCollapse();
      }}
      className="flex flex-col gap-3"
    >
      {steps.map((config, index) => (
        <AccordionStep
          key={config.key}
          index={index}
          state={activeIndex === index ? 'active' : stateFor(index)}
          config={config}
          onOpen={() => onOpenStep(index)}
          changeLabel={changeLabel}
          optionalLabel={optionalLabel}
        />
      ))}
    </div>
  );
}
