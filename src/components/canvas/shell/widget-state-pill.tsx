/* ────────────────────────────────────────────────────────────────────
   WidgetStatePill — 위젯 헤더 우측의 상태 pill primitive.

   SSOT: widget-shell 헤더에 인라인으로 있던 PopStatePill 의 라벨 계산
   (popStatePillLabel) + 톤 (pillVisual) + 렌더를 primitive 로 추출.
   순수 프레젠테이션 — `state: WidgetStateInfo` 를 prop 으로 받는다. 위젯
   본문 ↔ 헤더를 잇는 WidgetStateContext 구독은 소비처(widget-shell 의
   얇은 래퍼)가 담당하고, 이 primitive 는 넘어온 state 만 그린다. 덕분에
   카탈로그에서도 context 없이 각 상태를 standalone 데모할 수 있다.

   상태별 시각 (design-system token 만):
     - idle    → "READY" · 흰 bg + 검은 border (기본 Memphis pill)
     - running → "<LABEL> NN%" · amore 핑크 bg + 흰 텍스트 + 깜빡이는 도트
     - done    → "DONE" · mint bg + 검은 텍스트
     - error   → "ERR" · warning bg/텍스트/border (message 는 title 로)

   시각 회귀 0 — 추출 전 인라인 값 (className / inline style / shadow /
   radius) 을 그대로 보존.
   ──────────────────────────────────────────────────────────────────── */

import type { WidgetStateInfo } from '../widget-types';

// pill 의 노출 텍스트. running 일 때 body 가 progress 를 push 하면
// "<LABEL> NN%" 로 합쳐서 보여주고, label 만 있으면 라벨, 아무것도 없으면
// 그냥 "RUNNING" — realtime 위젯 (translate 등) 의 progress-less 경로.
export function widgetStatePillLabel(state: WidgetStateInfo): string {
  switch (state.kind) {
    case 'running': {
      const base = (state.label ?? 'RUNNING').toUpperCase();
      if (typeof state.progress === 'number') {
        const pct = Math.max(0, Math.min(100, Math.round(state.progress)));
        return `${base} ${pct}%`;
      }
      return base;
    }
    case 'done':
      return 'DONE';
    case 'error':
      return 'ERR';
    case 'idle':
    default:
      return 'READY';
  }
}

// state 별 시각. idle = 흰 bg + 검은 border (기본 Memphis pill).
// running = amore 핑크 bg + 흰 텍스트 + 좌측 깜빡이는 도트.
// done = mint bg + 검은 텍스트. error = warning bg + warning 텍스트 +
//   warning border. 모두 design-system token 만.
function pillVisual(kind: WidgetStateInfo['kind']): {
  background: string;
  color: string;
  border: string;
} {
  switch (kind) {
    case 'running':
      return {
        background: 'var(--color-amore)',
        color: 'var(--canvas-card-bg)',
        border: '2px solid var(--canvas-card-border)',
      };
    case 'done':
      return {
        background: 'var(--color-mint, var(--canvas-card-bg))',
        color: 'var(--canvas-card-border)',
        border: '2px solid var(--canvas-card-border)',
      };
    case 'error':
      return {
        background: 'var(--color-warning-bg)',
        color: 'var(--color-warning)',
        border: '2px solid var(--color-warning)',
      };
    case 'idle':
    default:
      return {
        background: 'var(--canvas-card-bg)',
        color: 'var(--canvas-card-border)',
        border: '2px solid var(--canvas-card-border)',
      };
  }
}

// seg 모드 (통합 툴바 세그먼트) 의 상태별 도트·텍스트 색 — border/shadow 없이
// 텍스트+도트만. idle=success 도트(READY)·running=amore·done=success·error=warning.
function segDot(kind: WidgetStateInfo['kind']): string {
  switch (kind) {
    case 'running':
      return 'var(--color-amore)';
    case 'error':
      return 'var(--color-warning)';
    case 'done':
    case 'idle':
    default:
      return 'var(--color-success, #16a34a)';
  }
}

export type WidgetStatePillProps = {
  // 그릴 상태. 소비처(widget-shell)가 WidgetStateContext 에서 읽어 넘긴다.
  state: WidgetStateInfo;
  // seg=true → 통합 툴바 pill 안의 세그먼트 (● dot + 라벨, 개별 border/shadow
  // 없음). WIDGET-SHELL §S1: status seg = ● dot + READY/LIVE.
  seg?: boolean;
};

export function WidgetStatePill({ state, seg = false }: WidgetStatePillProps) {
  const title =
    state.kind === 'error' && state.message ? state.message : undefined;
  if (seg) {
    return (
      <span
        data-ds-primitive="WidgetStatePill"
        className="inline-flex shrink-0 items-center gap-1 px-2.5 text-xs font-bold uppercase tracking-wider tabular-nums text-ink"
        title={title}
        aria-live={state.kind === 'running' ? 'polite' : undefined}
      >
        <span
          aria-hidden
          className={state.kind === 'running' ? 'animate-pulse' : undefined}
          style={{ color: segDot(state.kind) }}
        >
          ●
        </span>
        {widgetStatePillLabel(state)}
      </span>
    );
  }
  const visual = pillVisual(state.kind);
  return (
    <span
      data-ds-primitive="WidgetStatePill"
      className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
      style={{
        background: visual.background,
        color: visual.color,
        border: visual.border,
        borderRadius: 4,
        boxShadow: '2px 2px 0 var(--canvas-card-border)',
      }}
      title={title}
      aria-live={state.kind === 'running' ? 'polite' : undefined}
    >
      {state.kind === 'running' && (
        <span aria-hidden className="animate-pulse">
          ●
        </span>
      )}
      {widgetStatePillLabel(state)}
    </span>
  );
}
