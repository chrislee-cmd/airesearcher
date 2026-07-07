'use client';

import { Button } from '@/components/ui/button';

// ─── StageFlow — 공정 플로우차트 아티팩트 primitive ───────────────────────────
// 위젯 스트리밍(입력 → 스트리밍 → 결과물)의 가운데 단계를, "생성기가 지금 어떤
// 공정 단계를 거치는지" 를 플로우차트로 시각화하는 공용 아티팩트. 단계 노드 +
// 연결 엣지로 구성되고, done→active 엣지에는 흐름 애니메이션(marching dashes),
// active 노드에는 amore glow pulse 가 얹힌다. 전 단계 완료 시 complete=true 로
// 완료 hero(체크 + 라벨 + "결과 보기" CTA)로 전환한다.
//
// 이 PR 은 primitive 만 — 실제 위젯 wire(데스크 #439 / 인터뷰V2 #440)는 이걸
// blocked_by 로 물고 있는 후속 PR. 여기서는 어느 위젯도 아직 소비하지 않는다.
//
// 디자인 정합 (PROJECT.md §9): 토큰만 사용(border-line/bg-paper/text-amore/
// text-mute-soft/warning), 4px radius(rounded-xs), 1px border, no shadow, 단일
// amore 액센트. 색 하드코드 없음. error 톤은 앱 관례상 warning 토큰을 재사용
// (전용 error 토큰이 없어 JobProgress·Input 과 동일하게 warning 을 씀).
//
// 애니메이션은 신규 lib 없이 globals.css keyframe 으로만 구현되고
// prefers-reduced-motion 을 존중한다(모션 off 시 상태 색만).

export type StageStatus = 'pending' | 'active' | 'done' | 'error';

export type Stage = {
  id: string;
  label: string;
  status: StageStatus;
  // active 단계의 진행 세부 (예: "47/240 수집중"). active 에서만 노출.
  hint?: string;
};

export type StageFlowProps = {
  stages: Stage[];
  // 기본 horizontal. 좁은 카드는 호출부가 vertical 을 주입(반응형).
  orientation?: 'horizontal' | 'vertical';
  // 전 단계 done → 완료 hero 로 전환.
  complete?: boolean;
  completeLabel?: string;
  // 완료 hero 의 "결과 보기" CTA. 없으면 CTA 미노출.
  onResult?: () => void;
  resultLabel?: string;
  className?: string;
};

// 상태별 노드 chrome — 색(border/bg/text)은 여기서만 소유(BASE 는 색 없음,
// PROJECT.md §7.11 primitive BASE 색 금지 함정 회피). 채워진 노드 = amore-bg
// tint(done) / warning-bg tint(error).
const NODE_TONE: Record<StageStatus, string> = {
  pending: 'border-line-soft bg-paper text-mute-soft',
  active: 'border-amore bg-paper text-ink stage-flow-node-active',
  done: 'border-amore bg-amore-bg text-ink',
  error: 'border-warning bg-warning-bg text-warning',
};

function StageMarker({ status }: { status: StageStatus }) {
  if (status === 'done') {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 shrink-0 text-amore"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 8.5l3 3 6-6.5" />
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M8 3.5v5.5" />
        <path d="M8 12.2v.2" />
      </svg>
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-amore"
      />
    );
  }
  // pending — hollow mute ring
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full border border-mute-soft"
    />
  );
}

function StageNode({ stage }: { stage: Stage }) {
  return (
    <div
      className={`inline-flex shrink-0 items-center gap-2 rounded-xs border px-3 py-2 text-sm ${NODE_TONE[stage.status]}`}
    >
      <StageMarker status={stage.status} />
      <span
        className={
          stage.status === 'pending' ? 'whitespace-nowrap' : 'whitespace-nowrap font-medium'
        }
      >
        {stage.label}
      </span>
    </div>
  );
}

// 두 노드 사이 엣지 — 왼쪽 노드가 done 이면 amore 흐름(marching dashes), 아니면
// 정적 mute line. flowing 판정: 데이터가 방금 통과해 다음 단계로 흐르는 구간
// = 왼쪽 done && 오른쪽 active.
function edgeFlowing(left: StageStatus, right: StageStatus): boolean {
  return left === 'done' && right === 'active';
}

function HorizontalEdge({ flowing }: { flowing: boolean }) {
  return (
    <div
      aria-hidden
      className={`h-px min-w-[24px] flex-1 self-center ${
        flowing ? 'stage-flow-edge-flow-h' : 'bg-line-soft'
      }`}
    />
  );
}

function VerticalEdge({ flowing }: { flowing: boolean }) {
  return (
    <div
      aria-hidden
      className={`mx-auto h-5 w-px ${
        flowing ? 'stage-flow-edge-flow-v' : 'bg-line-soft'
      }`}
    />
  );
}

function CompleteHero({
  completeLabel,
  onResult,
  resultLabel = '결과 보기',
  className,
}: {
  completeLabel?: string;
  onResult?: () => void;
  resultLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-4 py-8 text-center ${className ?? ''}`}
    >
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-amore bg-amore-bg text-amore">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 6.5" />
        </svg>
      </span>
      {completeLabel ? (
        <p className="text-lg font-semibold text-ink">{completeLabel}</p>
      ) : null}
      {onResult ? (
        <Button size="cta" onClick={onResult} className="completed-cta-pulse">
          {resultLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function StageFlow({
  stages,
  orientation = 'horizontal',
  complete = false,
  completeLabel,
  onResult,
  resultLabel,
  className,
}: StageFlowProps) {
  // 완료 화면이 최우선 — 전 단계 done 이면 노드 플로우 대신 완료 hero.
  if (complete) {
    return (
      <CompleteHero
        completeLabel={completeLabel}
        onResult={onResult}
        resultLabel={resultLabel}
        className={className}
      />
    );
  }

  // flexible-by-omission — stages 비면 아무것도 안 그림.
  if (stages.length === 0) return null;

  const isVertical = orientation === 'vertical';
  const activeHint = stages.find((s) => s.status === 'active' && s.hint)?.hint;

  if (isVertical) {
    // node·hint·edge 를 같은 column 의 직속 형제로 배치 — 엣지는 mx-auto 로
    // column 중앙에 정렬(노드도 items-center 라 노드 아래 중앙에 옴).
    return (
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        {stages.map((stage, i) => (
          <div key={stage.id} className="contents">
            <StageNode stage={stage} />
            {stage.status === 'active' && stage.hint ? (
              <span className="mt-1 whitespace-nowrap text-xs tabular-nums text-mute-soft">
                {stage.hint}
              </span>
            ) : null}
            {i < stages.length - 1 ? (
              <VerticalEdge
                flowing={edgeFlowing(stage.status, stages[i + 1].status)}
              />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  // horizontal — 노드·엣지를 flex row 의 직속 형제로 두어야 엣지 flex-1 이 남는
  // 폭을 고르게 나눈다(wrapper 로 감싸면 분배가 깨짐). items-center 로 엣지가
  // 노드 세로 중앙에 정렬. active hint 는 노드 아래로 흐르지 않도록 flow 전체
  // 아래 한 줄로 모아 표시(overflow-x 안전).
  return (
    <div className={className}>
      <div className="flex items-center overflow-x-auto">
        {stages.map((stage, i) => (
          <div key={stage.id} className="contents">
            <StageNode stage={stage} />
            {i < stages.length - 1 ? (
              <HorizontalEdge
                flowing={edgeFlowing(stage.status, stages[i + 1].status)}
              />
            ) : null}
          </div>
        ))}
      </div>
      {activeHint ? (
        <p className="mt-2 text-xs tabular-nums text-mute-soft">{activeHint}</p>
      ) : null}
    </div>
  );
}
