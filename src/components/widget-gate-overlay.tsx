'use client';

import { useTranslations } from 'next-intl';
import { useWidgetGateEntry } from '@/components/widget-gate-provider';

// 위젯 국소 대기 오버레이 (#512) — 전역 대기실(#505)을 대체.
//
// widget-shell 이 모든 카드를 감싸며 자기 key 로 이 오버레이를 마운트한다.
// 게이트 phase 가 'waiting' 인 위젯 카드에만 반투명 오버레이가 뜨고, 나머지
// 위젯·캔버스는 정상 조작된다. 앞사람이 나가 자동 admit 되면 provider 가
// phase 를 'active' 로 바꿔 오버레이가 사라지고 보류됐던 작업이 진행된다.
//
// 카드 body 안(absolute inset-0)에 얹히므로 풀스크린 대기실과 달리 카드
// 프레임 안에서만 렌더. z-overlay 로 카드 내부 CTA 위에 확실히 얹는다.

export function WidgetGateOverlay({ widget }: { widget: string }) {
  const entry = useWidgetGateEntry(widget);
  const t = useTranslations('WidgetGate');

  if (entry.phase !== 'waiting') return null;

  return (
    <div
      className="absolute inset-0 z-overlay flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{
        background: 'color-mix(in srgb, var(--canvas-card-bg) 88%, transparent)',
        backdropFilter: 'blur(2px)',
      }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="animate-pulse text-2xl"
        style={{ color: 'var(--color-amore)' }}
      >
        ●
      </span>
      <p className="text-base font-semibold tracking-tight text-ink">
        {t('title')}
      </p>
      {entry.position != null && (
        <p className="text-lg font-bold text-amore">
          {t('positionAhead', { count: entry.position })}
        </p>
      )}
      <p className="max-w-xs text-sm leading-relaxed text-mute">{t('body')}</p>
    </div>
  );
}
