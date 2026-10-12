'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetCreditBadge — 위젯 헤더 좌측의 크레딧(cost) 배지 primitive.

   SSOT: widget-shell 헤더에 인라인으로 있던 CostBadge 렌더 규칙을
   primitive 로 추출. 순수 프레젠테이션 — `cost` / `costLabel` 을 prop 으로
   받아 세 갈래로 그린다:
     - costLabel 있음 → 그 문자열 그대로 (probing 처럼 lifecycle 차감 도구)
     - cost === 0     → "무료" 소형 텍스트
     - cost > 0       → 💎 + 숫자 pill
   costLabel 이 cost 보다 우선 (widget-types 의 계약과 동일).

   Soft Identity 리브랜드 1단계 — 핵심규칙 2/4/5: 중립 칩(`--fill` 면 + ink
   글자) · **테두리·그림자 없음** · pill · 숫자는 mono. 💎 는 크레딧 표기용
   예외로 유지(README §Assets).
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
        background: 'var(--fill)',
        color: 'var(--ink)',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-mono-soft)',
      }}
      aria-label={t('creditCost', { count: cost })}
    >
      <span aria-hidden>💎</span>
      <span>{cost}</span>
    </span>
  );
}
