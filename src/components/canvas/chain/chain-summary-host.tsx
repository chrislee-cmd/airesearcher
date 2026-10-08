'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainSummaryHost — 요약 pill 에 `ChainView` 를 물리는 얇은 컨테이너.

   pill 은 캔버스를 pan 해도 화면에 남아야 하므로(R5) **변환 레이어 밖**에
   마운트된다 — 그래서 오버레이와 분리돼 있다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { doneCount, type ChainView } from '@/lib/chains/view';
import {
  ChainSummaryPill,
  type ChainSummaryTone,
} from './chain-summary-pill';
import { useWidgetChain } from './widget-chain-provider';

export function ChainSummaryHost({
  onFocusChain,
  onHoverChange,
}: {
  onFocusChain: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const t = useTranslations('Chain');
  const { view } = useWidgetChain();
  if (!view) return null;

  const { text, tone } = summarize(view);

  function summarize(v: ChainView): { text: string; tone: ChainSummaryTone } {
    switch (v.status) {
      case 'running':
        return {
          text: t('status.running', {
            n: v.currentStep + 1,
            total: v.steps.length,
            step: t(`stepsShort.${v.steps[v.currentStep]?.feature}`),
          }),
          tone: 'processing',
        };
      case 'awaiting_approval':
        return { text: t('status.awaiting'), tone: 'amber' };
      case 'paused_insufficient_credits':
        return { text: t('status.paused'), tone: 'amber' };
      case 'error':
        return { text: t('status.ended'), tone: 'error' };
      case 'done':
        return {
          text: t('status.completedCount', {
            done: doneCount(v),
            total: v.steps.length,
          }),
          tone: 'success',
        };
      default:
        return { text: t('status.ended'), tone: 'mute' };
    }
  }

  return (
    <ChainSummaryPill
      mode={view.mode}
      statusText={text}
      tone={tone}
      onFocusChain={onFocusChain}
      onHoverChange={onHoverChange}
    />
  );
}
