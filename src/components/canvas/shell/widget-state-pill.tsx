/* ────────────────────────────────────────────────────────────────────
   WidgetStatePill — 위젯 헤더 우측의 상태 pill primitive.

   SSOT: widget-shell 헤더에 인라인으로 있던 PopStatePill 의 라벨 계산
   (popStatePillLabel) + 톤 (pillVisual) + 렌더를 primitive 로 추출.
   순수 프레젠테이션 — `state: WidgetStateInfo` 를 prop 으로 받는다. 위젯
   본문 ↔ 헤더를 잇는 WidgetStateContext 구독은 소비처(widget-shell 의
   얇은 래퍼)가 담당하고, 이 primitive 는 넘어온 state 만 그린다. 덕분에
   카탈로그에서도 context 없이 각 상태를 standalone 데모할 수 있다.

   **Soft Identity 리브랜드 1단계** — 셸 ① 의 상태 배지. 핵심규칙 4:
   "상태 배지는 테두리가 없다 — 틴트 면(--*-bg) + 진한 글자(--*-fg) + 6px 점",
   핵심규칙 2 "배지에 그림자 없음", 핵심규칙 5 "pill".

   상태별 시각 (Soft 토큰만):
     - idle    → "READY" · --fill 면 + --mute 글자 + --faint 점
     - running → "<LABEL> NN%" · --run-bg 면 + --run-fg 글자 + 깜빡이는 --run-dot
     - done    → "DONE" · --ok-bg 면 + --ok-fg 글자 + --ok-dot 점
     - error   → "ERR" · --err-bg 면 + --err-fg 글자 + --err-dot 점 (message=title)

   라벨 계산(widgetStatePillLabel)·상태 계약·aria 는 불변 — 시각 값만 교체.
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

// state 별 시각 — Soft 시그널 쌍(bg + fg + dot). 테두리/그림자 없음.
function pillVisual(kind: WidgetStateInfo['kind']): {
  background: string;
  color: string;
  dot: string;
} {
  switch (kind) {
    case 'running':
      return {
        background: 'var(--run-bg)',
        color: 'var(--run-fg)',
        dot: 'var(--run-dot)',
      };
    case 'done':
      return {
        background: 'var(--ok-bg)',
        color: 'var(--ok-fg)',
        dot: 'var(--ok-dot)',
      };
    case 'error':
      return {
        background: 'var(--err-bg)',
        color: 'var(--err-fg)',
        dot: 'var(--err-dot)',
      };
    case 'idle':
    default:
      return {
        background: 'var(--fill)',
        color: 'var(--mute)',
        dot: 'var(--faint)',
      };
  }
}

export type WidgetStatePillProps = {
  // 그릴 상태. 소비처(widget-shell)가 WidgetStateContext 에서 읽어 넘긴다.
  state: WidgetStateInfo;
};

export function WidgetStatePill({ state }: WidgetStatePillProps) {
  const visual = pillVisual(state.kind);
  const title =
    state.kind === 'error' && state.message ? state.message : undefined;
  return (
    <span
      data-ds-primitive="WidgetStatePill"
      className="inline-flex shrink-0 items-center gap-1.5 px-2 py-[3px] text-xs font-bold uppercase tracking-wider tabular-nums"
      style={{
        background: visual.background,
        color: visual.color,
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-mono-soft)',
      }}
      title={title}
      aria-live={state.kind === 'running' ? 'polite' : undefined}
    >
      {/* 6px 점 — running 만 깜빡인다(핵심규칙: 진행 점 깜빡임은 running 한정,
          prefers-reduced-motion 이면 globals.css 가 애니메이션을 끈다). */}
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full${
          state.kind === 'running' ? ' animate-pulse' : ''
        }`}
        style={{ background: visual.dot }}
      />
      {widgetStatePillLabel(state)}
    </span>
  );
}
