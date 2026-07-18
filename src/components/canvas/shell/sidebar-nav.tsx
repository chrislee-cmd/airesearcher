'use client';

/* ────────────────────────────────────────────────────────────────────
   SidebarNav — 공유 전체보기 모달의 좌측 위젯 네비게이션 (240px).

   - canvas 순서(CANVAS_ORDER 필터)대로 위젯을 세로 나열.
   - 활성 항목 = Memphis 박스 (border + offset shadow).
   - 각 항목: accent 도트 + 라벨 + 실시간 state badge (running/done/error).
     라벨은 flex-1 로 남는 폭을 차지하고 badge 는 shrink-0 우측 고정 —
     라벨이 badge 에 가려지지 않게.
   - 1~6 단축키 자체는 CanvasBoard 가 처리 (시각 kbd 힌트는 noise 라 제거).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
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
    // Wave3 주의 환기 — state.kind 가 바뀌면 key remount 로 .pop-in 재생(살짝
    // bounce). .pop-in 은 globals.css 에서 reduced-motion 을 독립 존중.
    <span
      key={state.kind}
      className="pop-in inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
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

// locked(준비중) 위젯 행에 붙는 정적 배지. state badge 자리를 재사용 —
// locked 위젯은 idle 이라 WidgetStateBadge 가 null 이므로 자리 충돌 없음.
// 색은 design-system 토큰만 (중립 line-soft 테두리 + mute 텍스트) — 라이브
// 위젯의 amore/mint 강조와 시각 구분.
function WidgetLockedBadge() {
  const t = useTranslations('Shell');
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-xs border-[2px] border-line-soft bg-paper-soft px-1.5 py-0.5 text-xs font-semibold text-mute-soft"
      aria-label={t('locked')}
    >
      {t('locked')}
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
  lockedKeys,
}: {
  widgets: WidgetContent[];
  current: string | null;
  onSwitch: (key: string) => void;
  // 준비중(gated) 위젯 key 목록. 해당 행은 "준비중" 배지 + dim 톤.
  // 비었으면(unlimited) 전부 라이브 → 회귀 0.
  lockedKeys?: string[];
}) {
  const t = useTranslations('Shell');
  const tRoot = useTranslations();
  const locked = lockedKeys && lockedKeys.length > 0 ? new Set(lockedKeys) : null;
  return (
    <nav
      aria-label={t('navLabel')}
      className="flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto border-r-[2px] border-ink bg-paper-soft p-3"
    >
      {widgets.map((w) => {
        const active = w.key === current;
        const isLocked = locked?.has(w.key) ?? false;
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
            <span
              className={`flex min-w-0 flex-1 items-center gap-2 ${
                // locked 행은 dim — 라이브 위젯과 시각 구분. active 여도 dim
                // 유지(준비중이라 강조 대상 아님). reduced-motion 무관(정적).
                isLocked && !active ? 'opacity-60' : ''
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${ACCENT_BG[w.meta.accent]}`}
                aria-hidden
              />
              <span className="truncate">
                {w.meta.labelKey ? tRoot(w.meta.labelKey) : w.meta.label}
              </span>
            </span>
            {isLocked ? <WidgetLockedBadge /> : <WidgetStateBadge widgetKey={w.key} />}
          </button>
        );
      })}
    </nav>
  );
}
