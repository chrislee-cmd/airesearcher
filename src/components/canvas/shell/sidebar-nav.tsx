'use client';

/* ────────────────────────────────────────────────────────────────────
   SidebarNav — 공유 전체보기 모달의 좌측 위젯 네비게이션 (200px).

   - canvas 순서(CANVAS_ORDER 필터)대로 위젯을 세로 나열.
   - 활성 항목 = Memphis 박스 (border + offset shadow).
   - 각 항목: accent 도트 + 라벨 + 실시간 state badge (running/done/error).
   - 1~6 단축키 힌트 (kbd). 단축키 자체는 CanvasBoard 가 처리.
   ──────────────────────────────────────────────────────────────────── */

import type { WidgetContent, WidgetStateInfo } from '../widget-types';
import { useWidgetStateOf } from './widget-state-context';
import { ACCENT_BG } from './tokens';

// 사이드바 항목의 state badge — 헤더 PopStatePill 의 축약판. running/error
// 만 강조하고 done 은 mint 점, idle 은 표시 없음 (소음 최소화).
function WidgetStateBadge({ widgetKey }: { widgetKey: string }) {
  const state = useWidgetStateOf(widgetKey);
  const visual = badgeVisual(state);
  if (!visual) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
      style={{
        background: visual.background,
        color: visual.color,
        border: visual.border,
        borderRadius: 4,
      }}
      aria-live={state.kind === 'running' ? 'polite' : undefined}
    >
      {state.kind === 'running' && (
        <span aria-hidden className="animate-pulse">
          ●
        </span>
      )}
      {visual.label}
    </span>
  );
}

function badgeVisual(
  state: WidgetStateInfo,
): { label: string; background: string; color: string; border: string } | null {
  switch (state.kind) {
    case 'running': {
      const label = (state.label ?? 'RUNNING').toUpperCase();
      return {
        label,
        background: 'var(--color-amore)',
        color: 'var(--canvas-card-bg)',
        border: '2px solid var(--color-ink)',
      };
    }
    case 'done':
      return {
        label: 'DONE',
        background: 'var(--color-mint, var(--canvas-card-bg))',
        color: 'var(--color-ink)',
        border: '2px solid var(--color-ink)',
      };
    case 'error':
      return {
        label: 'ERR',
        background: 'var(--color-warning-bg)',
        color: 'var(--color-warning)',
        border: '2px solid var(--color-warning)',
      };
    case 'idle':
    default:
      return null;
  }
}

export function SidebarNav({
  widgets,
  current,
  onSwitch,
}: {
  widgets: WidgetContent[];
  current: string | null;
  onSwitch: (key: string) => void;
}) {
  return (
    <nav
      aria-label="위젯 전체보기 네비게이션"
      className="flex w-[200px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r-[2px] border-ink bg-paper-soft p-3"
    >
      {widgets.map((w, idx) => {
        const active = w.key === current;
        return (
          // eslint-disable-next-line react/forbid-elements -- 좌측 nav 항목은 Button primitive 의 어떤 variant 와도 맞지 않는 rich 레이아웃(accent 도트 + 라벨 + state badge + Memphis 활성 박스)이라 native <button> 사용. 전용 nav primitive 는 별 PR.
          <button
            key={w.key}
            type="button"
            onClick={() => onSwitch(w.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center justify-between gap-2 rounded-xs border-[2px] px-3 py-2 text-left text-sm font-medium transition-colors ${
              active
                ? 'border-ink bg-paper text-ink shadow-[2px_2px_0_var(--color-ink)]'
                : 'border-transparent text-mute-soft hover:bg-paper hover:text-ink'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${ACCENT_BG[w.meta.accent]}`}
                aria-hidden
              />
              <span className="truncate">{w.meta.label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <WidgetStateBadge widgetKey={w.key} />
              {idx < 9 ? (
                <kbd
                  aria-hidden
                  className="hidden shrink-0 rounded-xs border border-line px-1 text-xs tabular-nums text-mute-soft sm:inline"
                >
                  {idx + 1}
                </kbd>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
