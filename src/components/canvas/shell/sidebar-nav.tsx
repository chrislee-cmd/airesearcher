'use client';

/* ────────────────────────────────────────────────────────────────────
   SidebarNav — 공유 전체보기 모달의 좌측 위젯 네비게이션 (240px).

   Soft Identity 리브랜드 1단계 — FullviewSidebar(V2)와 같은 변환표 규칙:
   `--surface-2` · border-r 1 `--hair` · 활성 = 흰 bg + 1px `--line` + 700 ·
   배지는 틴트 면 + 진한 글자 + 점(테두리/그림자 0). 폭 240·패딩 불변.

   - canvas 순서(CANVAS_ORDER 필터)대로 위젯을 세로 나열.
   - 활성 항목 = 흰 면 + 1px `--line`.
   - 각 항목: accent 도트 + 라벨 + 실시간 state badge (running/done/error).
     라벨은 flex-1 로 남는 폭을 차지하고 badge 는 shrink-0 우측 고정 —
     라벨이 badge 에 가려지지 않게.
   - 1~6 단축키 자체는 CanvasBoard 가 처리 (시각 kbd 힌트는 noise 라 제거).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import {
  resolveWidgetLabel,
  type WidgetContent,
  type WidgetStateInfo,
} from '../widget-types';
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
      className="pop-in inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
      style={{
        background: visual.background,
        color: visual.color,
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-mono-soft)',
      }}
      aria-live={state.kind === 'running' ? 'polite' : undefined}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full${
          state.kind === 'running' ? ' animate-pulse' : ''
        }`}
        style={{ background: visual.dot }}
      />
      {visual.label}
    </span>
  );
}

// locked(준비중) 위젯 행에 붙는 정적 배지. state badge 자리를 재사용 —
// locked 위젯은 idle 이라 WidgetStateBadge 가 null 이므로 자리 충돌 없음.
// 색은 Soft 중립 토큰만 (--fill 면 + --faint 글자) — 라이브 위젯의 시그널
// 틴트 배지와 시각 구분.
function WidgetLockedBadge() {
  const t = useTranslations('Shell');
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-soft-fill px-2 py-0.5 font-soft-mono text-xs font-semibold text-soft-faint"
      aria-label={t('locked')}
    >
      {t('locked')}
    </span>
  );
}

function badgeVisual(
  state: WidgetStateInfo,
): { label: string; background: string; color: string; dot: string } | null {
  switch (state.kind) {
    case 'running': {
      const label = (state.label ?? 'RUNNING').toUpperCase();
      return {
        label,
        background: 'var(--run-bg)',
        color: 'var(--run-fg)',
        dot: 'var(--run-dot)',
      };
    }
    case 'done':
      return {
        label: 'DONE',
        background: 'var(--ok-bg)',
        color: 'var(--ok-fg)',
        dot: 'var(--ok-dot)',
      };
    case 'error':
      return {
        label: 'ERR',
        background: 'var(--err-bg)',
        color: 'var(--err-fg)',
        dot: 'var(--err-dot)',
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
      className="flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-soft-hair bg-soft-surface-2 p-3"
    >
      {widgets.map((w) => {
        const active = w.key === current;
        const isLocked = locked?.has(w.key) ?? false;
        return (
          // eslint-disable-next-line react/forbid-elements -- 좌측 nav 항목은 Button primitive 의 어떤 variant 와도 맞지 않는 rich 레이아웃(accent 도트 + 라벨 + state badge + 활성 박스)이라 native <button> 사용. 전용 nav primitive 는 별 PR.
          <button
            key={w.key}
            type="button"
            onClick={() => onSwitch(w.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex w-full items-center justify-between gap-2 rounded-nav border px-3 py-2 text-left text-sm transition-colors ${
              active
                ? 'border-soft-line bg-soft-surface font-bold text-ink'
                : 'border-transparent font-medium text-soft-mute hover:bg-soft-surface hover:text-ink'
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
              <span className="truncate">{resolveWidgetLabel(tRoot, w.meta)}</span>
            </span>
            {isLocked ? <WidgetLockedBadge /> : <WidgetStateBadge widgetKey={w.key} />}
          </button>
        );
      })}
    </nav>
  );
}
