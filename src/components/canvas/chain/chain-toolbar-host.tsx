'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainToolbarHost — 툴바에 레인/체인 상태를 물리는 얇은 컨테이너.

   툴바는 캔버스를 pan/zoom 해도 화면에 남아야 하므로 **변환 레이어 밖**에
   마운트된다(LEARNINGS §3-1). 요약 pill 은 레인이 화면 밖일 때의 최소 신호다 —
   그래서 **조립 중에는 띄우지 않는다**(CD 장면: L0~L3 는 pill 없음, L4 부터
   hasPill). 조립 중에는 레인 헤더가 바로 아래 있어 같은 문구가 두 번 보이고,
   실제로 헤더를 가린다(프리뷰 실측).
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
  const { lane, createLane, locked } = useChainLane();
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
        lane && locked
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
