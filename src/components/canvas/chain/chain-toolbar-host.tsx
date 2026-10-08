'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainToolbarHost — 툴바에 레인/체인 상태를 물리는 얇은 컨테이너.

   툴바는 캔버스를 pan/zoom 해도 화면에 남아야 하므로 **변환 레이어 밖**에
   마운트된다(LEARNINGS §3-1). 요약 pill 은 레인이 화면 밖일 때의 최소 신호다.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { ChainToolbar } from './chain-toolbar';
import { laneStatus } from './chain-lane-host';
import { useChainLane } from './chain-lane-provider';
import { useWidgetChain } from './widget-chain-provider';

export function ChainToolbarHost({
  onFocusLane,
}: {
  onFocusLane: () => void;
}) {
  const t = useTranslations('Chain');
  const { lane, createLane } = useChainLane();
  const { view } = useWidgetChain();
  const { statusText, statusTone } = laneStatus(
    view,
    lane?.cards.length ?? 0,
    t,
  );

  return (
    <ChainToolbar
      locked={!!lane}
      onNewChain={createLane}
      summary={
        lane
          ? {
              mode: view?.mode ?? 'approve',
              text: statusText,
              tone: statusTone,
              onFocusLane,
            }
          : null
      }
    />
  );
}
