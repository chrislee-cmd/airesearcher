'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetAccordion — 위젯 세팅 "유스케이스 4-스텝" 가이드 아코디언 (공유 셸).

   배경 (V2 세팅 개편 PR-B): probing / interpreter 두 위젯의 setup(idle)
   컨트롤이 "스펙 단위 평면 리스트"(프로젝트/캡처/언어/목적|용어)로 한꺼번에
   노출됐다. 이를 유스케이스 순서(프로젝트 → 인터뷰 방식 → 언어 → 질문|용어)의
   4-스텝 가이드로 재구성해 사용자를 안내한다.

   ── R1 reconcile (Canvas 1c 타깃) ────────────────────────────────────
   integ 빌드는 "한 번에 한 스텝(auto-advance) + 보더 카드 스택"이었으나, CD
   확정 타깃(`Widgets Canvas 1c.dc.html`)은 **전체 오픈 기본 + 번호 타임라인
   레일**이다. 이 셸이 그 표현으로 정렬한다.

   펼침 규칙 (all-open):
     - 마운트 시 미완 스텝은 **전부 펼침**(body 노출), 완료 스텝은 **요약으로
       접힘**(개별). 한 번에 하나 아님 — 여러 스텝 동시 펼침 허용.
     - 스텝 완료 → 그 스텝만 요약 접힘(auto). 완료 판정은 호출부(isComplete).
     - 접힌 스텝(완료 요약 / 컬랩스된 미완) 클릭 → 재오픈(onOpenStep).
     - 빈영역(스텝 사이 gap / 레일 여백) 클릭 → **전체 컬랩스**
       (target===currentTarget 가드, onCollapseAll).

   비주얼 (번호 타임라인 레일):
     - 좌측 세로선(bg-line = ink 12%, 2px) + 스텝별 원형 번호 노드가 레일에
       매달린다. 보더 카드 스택 아님.
     - 노드 3-상태(완료 우선, 그다음 진행 위치):
         done   = 완료         → bg-success + ✓
         active = 첫 미완(현재) → bg-ink + 번호
         todo   = 그 뒤 미완    → bg-line-soft + 번호
     - 노드 우측에 스텝 타이틀 + body 세로 나열. done 접힘 = 요약 1줄
       (eyebrow + 값 + "변경"), 미완 접힘 = 타이틀 1줄.

   ⚠️ 라이브 회귀 0: 이 셸은 idle/setup 만 감싼다. 라이브 표면(프롬프터/페르소나/
   종료/공유)은 각 위젯이 그대로 렌더 — 아코디언 밖.

   높이: 위젯 카드 높이는 캔버스 그리드(CELL_H)가 고정하고, 세팅 표면은
   ControlBoardPanel(flex-1 + overflow-y-auto)이 내부 스크롤을 담당한다 —
   스텝 펼침/접힘에도 위젯 높이는 불변, 초과분은 내부 스크롤. (공유 WidgetShell
   에 px 높이를 하드코딩하면 6위젯 전체 + CELL_H 와 충돌하므로 두지 않는다.)

   토큰만: 색/모서리/그림자 전부 tokens.json 어휘 (design-system 가드 준수).
   ──────────────────────────────────────────────────────────────────── */

import { useState, type ReactNode } from 'react';

export type AccordionStepState = 'active' | 'done' | 'todo';

// 한 스텝의 선언적 구성. 완료 여부는 호출부가 isComplete 로 계산해 넘긴다
// (스텝별 완료 규칙이 위젯마다 다름).
export type AccordionStepConfig = {
  // 안정 key (React list) + 접근성 id 접두.
  key: string;
  // 접힌 완료 스텝 eyebrow (예: "STEP 01 · 프로젝트"). done 요약에서 값 위에 노출.
  eyebrow: string;
  // 펼침/접힌 미완 스텝 제목 (예: "작업중인 프로젝트를 선택해주세요" / "프로젝트").
  title: string;
  // done 상태에서 노출할 값 요약 (예: 프로젝트명 / "한국어 → English").
  summary?: ReactNode;
  // 선택 스텝 표식 (예: interpreter 용어집). title 옆 "(선택)" 렌더.
  optional?: boolean;
  // 펼침 상태 바디 (컨트롤). 펼쳐졌을 때만 렌더.
  body: ReactNode;
};

// 아코디언 펼침 상태 훅 (all-open 모델).
//
//   isExpanded(index, complete) = 각 스텝이 body 를 노출할지 여부.
//     - 수동 override(manual)가 있으면 그 값(재오픈=true / 개별접기=false).
//     - collapseAll 이 눌렸으면 전부 false.
//     - 아니면 기본값 = !complete (미완이면 펼침, 완료면 요약 접힘).
//
//   open(i)        = 접힌 스텝 재오픈 (수동 override=true).
//   collapse(i)    = 개별 접기 (수동 override=false).
//   collapseAll()  = 빈영역 클릭 → 전체 접기 (manual 초기화 + collapsedAll).
export function useWidgetAccordion() {
  const [{ manual, collapsedAll }, setState] = useState<{
    manual: Record<number, boolean>;
    collapsedAll: boolean;
  }>({ manual: {}, collapsedAll: false });

  return {
    isExpanded: (index: number, complete: boolean): boolean => {
      if (index in manual) return manual[index];
      if (collapsedAll) return false;
      return !complete;
    },
    open: (index: number) =>
      setState((s) => ({ ...s, manual: { ...s.manual, [index]: true } })),
    collapse: (index: number) =>
      setState((s) => ({ ...s, manual: { ...s.manual, [index]: false } })),
    collapseAll: () => setState({ manual: {}, collapsedAll: true }),
  };
}

// 레일에 매달리는 원형 번호 노드 (3-상태). 배경색이 레일선을 덮어 노드가
// 선 위에 얹힌 것처럼 보인다 (z-10 은 호출부가 부여).
function StepNode({
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
  nodeState,
  expanded,
  complete,
  config,
  onOpen,
  changeLabel,
  optionalLabel,
}: {
  index: number;
  // 노드 색(완료 우선, 그다음 첫 미완=active / 나머지 미완=todo).
  nodeState: AccordionStepState;
  // body 노출 여부 (펼침).
  expanded: boolean;
  // 완료 여부 (접힘 시 요약행 vs 타이틀행 분기).
  complete: boolean;
  config: AccordionStepConfig;
  onOpen: () => void;
  // "변경" 링크 라벨 (완료 요약).
  changeLabel: string;
  // "(선택)" 표식 라벨 (optional 스텝).
  optionalLabel: string;
}) {
  const node = (
    <StepNode
      state={nodeState}
      label={nodeState === 'done' ? <CheckGlyph /> : index + 1}
    />
  );

  // 접힘 — 완료 스텝(요약행) / 미완 스텝(타이틀행). 클릭 시 재오픈.
  if (!expanded) {
    return (
      // eslint-disable-next-line react/forbid-elements -- 접힌 스텝 = 클릭 시 재오픈하는 요약/타이틀 행 (ui/ primitive 밖 셸 프리미티브 정의 지점)
      <button
        type="button"
        onClick={onOpen}
        // data-canvas-action: globals.css `[data-canvas-body] button` 캐스케이드
        // (2.5px ink 보더 + 하드 그림자 + radius 박스) 를 opt-out. 이게 없으면
        // 완료 스텝이 프로토(R6/D6)의 보더없는 요약행이 아니라 꽉 찬 박스로
        // 렌더돼 좌측 타임라인 레일이 끊긴다.
        data-canvas-action
        className="relative flex w-full items-center gap-3 text-left"
      >
        <span className="relative z-10">{node}</span>
        {complete ? (
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-mute">{config.eyebrow}</span>
              <span className="truncate text-sm font-bold text-ink">
                {config.summary}
              </span>
            </span>
            <span className="shrink-0 text-xs font-medium text-mute-soft">
              {changeLabel}
            </span>
          </span>
        ) : (
          <span className="text-sm font-semibold text-mute-soft">
            {config.title}
            {config.optional && (
              <span className="ml-1.5 text-xs font-medium">{optionalLabel}</span>
            )}
          </span>
        )}
      </button>
    );
  }

  // 펼침 — 번호 노드 + 타이틀 + body 세로 나열 (레일 우측 들여쓰기).
  return (
    <div className="relative flex items-start gap-3">
      <span className="relative z-10 shrink-0">{node}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex min-h-6 items-center gap-2">
          <span className="text-sm font-bold text-ink">{config.title}</span>
          {config.optional && (
            <span className="text-xs font-medium text-mute-soft">
              {optionalLabel}
            </span>
          )}
        </div>
        {config.body}
      </div>
    </div>
  );
}

// 4-스텝 아코디언 컨테이너 — 좌측 세로 레일 + 원형 번호 노드.
//   펼침 상태 = isExpanded(index, complete) (useWidgetAccordion 소유).
//   완료 여부 = isComplete(index) (호출부 소유 — 스텝별 규칙 상이).
//   노드 색 = 완료 우선(done), 그다음 첫 미완(active) / 나머지 미완(todo).
export function WidgetAccordion({
  steps,
  isExpanded,
  isComplete,
  onOpenStep,
  onCollapseAll,
  changeLabel,
  optionalLabel,
}: {
  steps: AccordionStepConfig[];
  isExpanded: (index: number, complete: boolean) => boolean;
  isComplete: (index: number) => boolean;
  onOpenStep: (index: number) => void;
  onCollapseAll: () => void;
  changeLabel: string;
  optionalLabel: string;
}) {
  // 첫 미완 스텝 = 현재 진행 위치(active 노드). 전부 완료면 -1.
  const firstIncomplete = steps.findIndex((_, index) => !isComplete(index));

  return (
    <div
      // 빈영역(스텝 사이 gap / 컨테이너 패딩) 클릭 → 전체 컬랩스. 스텝 행 내부
      // 클릭은 target!==currentTarget 이라 통과 (프로토 pCollapse 가드). 레일선은
      // pointer-events-none 이라 통과.
      onClick={(e) => {
        if (e.target === e.currentTarget) onCollapseAll();
      }}
      className="relative flex flex-col gap-6"
    >
      {/* 좌측 세로 레일 — 노드 중심(left-3 = 24px 노드 폭의 절반)을 관통하는
          연속선. 노드 배경이 이 선을 덮어 "레일에 매달린 노드" 표현. 첫/마지막
          노드 중심(top-3/bottom-3)에서 시작·종료해 위아래로 삐져나오지 않는다. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-3 bottom-3 w-0.5 -translate-x-1/2 bg-line"
      />
      {steps.map((config, index) => {
        const complete = isComplete(index);
        const nodeState: AccordionStepState = complete
          ? 'done'
          : index === firstIncomplete
            ? 'active'
            : 'todo';
        return (
          <AccordionStep
            key={config.key}
            index={index}
            nodeState={nodeState}
            expanded={isExpanded(index, complete)}
            complete={complete}
            config={config}
            onOpen={() => onOpenStep(index)}
            changeLabel={changeLabel}
            optionalLabel={optionalLabel}
          />
        );
      })}
    </div>
  );
}
