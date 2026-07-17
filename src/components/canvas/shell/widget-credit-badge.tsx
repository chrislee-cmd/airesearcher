'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetCreditBadge — 위젯 헤더 좌측의 크레딧(cost) 배지 primitive.

   SSOT: widget-shell 헤더에 인라인으로 있던 CostBadge 렌더 규칙을
   primitive 로 추출. 순수 프레젠테이션 — `cost` / `costLabel` 을 prop 으로
   받아 세 갈래로 그린다:
     - costLabel 있음 → 그 문자열 그대로 (probing 처럼 lifecycle 차감 도구)
     - cost === 0     → "무료" 소형 텍스트
     - cost > 0       → 💎 + 숫자 Memphis pill (검정 border + offset shadow +
                        흰 bg) — 배너 노랑 / pastel 위에서도 또렷.
   costLabel 이 cost 보다 우선 (widget-types 의 계약과 동일).

   시각 회귀 0 — 추출 전 인라인 값 (className / inline style / shadow /
   radius) 을 그대로 보존.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';

export type WidgetCreditBadgeProps = {
  // 크레딧 비용. undefined 면 아무것도 안 그린다 (cost 없는 위젯).
  cost: number | undefined;
  // cost 를 통째로 대체하는 라벨 (lifecycle 차감 도구). cost 보다 우선.
  costLabel: string | undefined;
};

export function WidgetCreditBadge({ cost, costLabel }: WidgetCreditBadgeProps) {
  const t = useTranslations('Shell');
  if (costLabel) {
    return (
      <span
        data-ds-primitive="WidgetCreditBadge"
        className="text-xs font-bold uppercase opacity-80"
      >
        {costLabel}
      </span>
    );
  }
  if (typeof cost !== 'number') return null;
  if (cost === 0) {
    return (
      <span
        data-ds-primitive="WidgetCreditBadge"
        className="text-xs font-bold uppercase opacity-80"
      >
        {t('free')}
      </span>
    );
  }
  return (
    <span
      data-ds-primitive="WidgetCreditBadge"
      className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-xs font-bold tabular-nums"
      style={{
        background: 'var(--canvas-card-bg)',
        color: 'var(--canvas-card-border)',
        border: '2px solid var(--canvas-card-border)',
        borderRadius: 4,
        boxShadow: '2px 2px 0 var(--canvas-card-border)',
      }}
      aria-label={t('creditCost', { count: cost })}
    >
      <span aria-hidden>💎</span>
      <span>{cost}</span>
    </span>
  );
}
