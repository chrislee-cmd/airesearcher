'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLaneProvider — 레인의 클라이언트 상태 + 도킹 판정 + 서버 체인 동기화.

   CD SSOT: `v3/README.md` State·Interactions. 상태 모양도 CD 그대로:
     lane: { cards: feature[], originIndex: Record<feature, Coords> } | null
     drag: { feature, over: slotIndex | null, valid, reason } | null

   ── 설계 결정 2가지 (writer 확정 2026-10-08) ──────────────────────────
   1) **수명주기**: 레인이 유효(2단계+ compat)해지는 순간 서버 체인을 POST 한다.
      B 의 advance 훅이 진입 위젯 완료 시 체인을 찾으려면 row 가 먼저 있어야 한다.
   2) **조립 변경**은 `syncComposition()` **함수 하나로 추상화**한다 — 지금은
      cancel + 재생성이지만, A″(`pr-chain-steps-patch`)가 머지되면 **이 함수
      내부만** PATCH 호출로 바뀌고 호출부는 그대로다. 수정 허용 범위도 A″ 기준에
      맞춘다: **전 단계 pending 인 실행 전 체인만** 편집, 종결(error/done/
      cancelled) 체인의 "같은 구성 재실행" 은 편집이 아니라 **새 체인 POST** 다.

   판정의 유일한 소유자는 A′ 의 `validateSteps` 다(`canDock` 경유) — 프론트가
   규칙을 복제하거나 detail 문구를 파싱하지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  canDock,
  type ChainStepFeature,
  type DockPosition,
  type DockVerdict,
} from '@/lib/chains/view';
import { useWidgetChain } from './widget-chain-provider';

export type LaneCoords = { col: number; row: number };

export type LaneState = {
  /** 도킹된 단계 — 레인 안 좌→우 순서. */
  cards: ChainStepFeature[];
  /** 해체 시 돌아갈 자리. 캔버스 배치가 index 기반({col,row})이라 그대로 저장. */
  originIndex: Record<string, LaneCoords>;
};

export type DragState = {
  feature: string;
  /** 레인 위에 있는가 — null 이면 레인 밖(평소 카드 이동). */
  over: DockPosition | null;
  valid: boolean;
  verdict: DockVerdict | null;
};

type LaneApi = {
  lane: LaneState | null;
  drag: DragState | null;
  /** 레인이 실행 중이라 구성을 바꿀 수 없는가(CD Interactions 잠금 집합). */
  locked: boolean;
  createLane: () => void;
  dissolveLane: () => void;
  /** 도킹 가능 판정 — 호스트/보드가 좌표 판정 후 이것으로 사유를 얻는다. */
  evaluate: (feature: string, position: DockPosition) => DockVerdict;
  setDrag: (next: DragState | null) => void;
  dock: (feature: ChainStepFeature, position: DockPosition, origin: LaneCoords) => void;
  undock: (feature: ChainStepFeature) => void;
  /** 해체 직후 1.6초 "원래 자리로" 배지를 띄울 대상. */
  restored: string[];
  /** 레인 본문 DOM — 좌표 판정의 기준. */
  laneBodyRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 도킹 카드가 portal 될 슬롯 DOM 등록(카드 remount 방지). */
  registerDockTarget: (feature: string, el: HTMLElement | null) => void;
  dockTargets: Record<string, HTMLElement | null>;
};

const LaneContext = createContext<LaneApi | null>(null);

const RESTORE_BADGE_MS = 1600;

export function ChainLaneProvider({ children }: { children: ReactNode }) {
  const { view, createChain, cancel, refresh } = useWidgetChain();
  const [lane, setLane] = useState<LaneState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [restored, setRestored] = useState<string[]>([]);
  const [dockTargets, setDockTargets] = useState<Record<string, HTMLElement | null>>({});
  const laneBodyRef = useRef<HTMLDivElement | null>(null);

  // 구성 잠금 — CD Interactions 는 `{running, awaiting_approval, paused}` 로
  // 적었지만, 그건 **체인이 실행 시점에야 생긴다는 v2 전제**에서 쓰인 집합이다.
  // v3 는 조립이 끝나는 순간 체인을 만들므로(수명주기 (가)) 그 집합을 그대로
  // 쓰면 **조립 직후부터 구성이 잠겨** L3 의 "양 끝에서 빼기" 가 불가능해진다.
  // 그래서 CD 의 의도("실행 중에는 바꿀 수 없다")를 실행 여부로 판정한다 —
  // 아직 아무 단계도 끝나지 않았으면(= 편집 가능) 잠그지 않는다. 종결 상태
  // (error/done/cancelled)도 CD 대로 잠금이 풀린다.
  const locked = !!view && !isEditable(view);

  /**
   * 조립 결과를 서버에 반영한다 — **교체 지점은 여기 하나뿐**이다.
   * A″(PATCH steps) 머지 후에는 이 함수 내부만 바뀐다(인터페이스 불변).
   */
  const syncComposition = useCallback(
    async (cards: ChainStepFeature[]) => {
      // 2단계 미만은 아직 체인이 아니다 — 서버에 만들지 않는다(초안).
      if (cards.length < 2) {
        // 이미 만들어 둔 실행 전 체인이 있으면 거둬들인다.
        if (view && isEditable(view)) await cancel();
        return;
      }
      if (!view) {
        await createChain({ steps: cards });
        return;
      }
      // 실행 전(전 단계 pending) 체인만 "편집" 대상 — A″ 기준과 정렬.
      // TODO(A″ `pr-chain-steps-patch`): 아래 cancel+재생성을 PATCH 한 번으로.
      if (isEditable(view)) {
        await cancel();
        await createChain({ steps: cards });
        return;
      }
      // 종결 체인에서 구성을 바꾸면 그건 편집이 아니라 새 체인이다.
      await createChain({ steps: cards });
    },
    [view, createChain, cancel],
  );

  const createLane = useCallback(() => {
    setLane({ cards: [], originIndex: {} });
  }, []);

  const dissolveLane = useCallback(() => {
    const cards = lane?.cards ?? [];
    setLane(null);
    setDrag(null);
    setRestored(cards);
    setTimeout(() => setRestored([]), RESTORE_BADGE_MS);
    // 실행 전 체인은 거둬들인다(종결 체인은 기록으로 남긴다).
    if (view && isEditable(view)) void cancel().then(() => refresh());
  }, [lane, view, cancel, refresh]);

  const evaluate = useCallback(
    (feature: string, position: DockPosition): DockVerdict =>
      canDock(lane?.cards ?? [], feature, position),
    [lane],
  );

  const dock = useCallback(
    (feature: ChainStepFeature, position: DockPosition, origin: LaneCoords) => {
      setLane((prev) => {
        const base = prev ?? { cards: [], originIndex: {} };
        if (base.cards.includes(feature)) return base;
        const cards =
          position === 'append'
            ? [...base.cards, feature]
            : [feature, ...base.cards];
        void syncComposition(cards);
        return {
          cards,
          originIndex: { ...base.originIndex, [feature]: origin },
        };
      });
      setDrag(null);
    },
    [syncComposition],
  );

  const undock = useCallback(
    (feature: ChainStepFeature) => {
      setLane((prev) => {
        if (!prev) return prev;
        const cards = prev.cards.filter((f) => f !== feature);
        void syncComposition(cards);
        const originIndex = { ...prev.originIndex };
        delete originIndex[feature];
        return { cards, originIndex };
      });
      setRestored([feature]);
      setTimeout(() => setRestored([]), RESTORE_BADGE_MS);
    },
    [syncComposition],
  );

  const registerDockTarget = useCallback(
    (feature: string, el: HTMLElement | null) => {
      setDockTargets((prev) =>
        prev[feature] === el ? prev : { ...prev, [feature]: el },
      );
    },
    [],
  );

  const api = useMemo<LaneApi>(
    () => ({
      lane,
      drag,
      locked,
      createLane,
      dissolveLane,
      evaluate,
      setDrag,
      dock,
      undock,
      restored,
      laneBodyRef,
      registerDockTarget,
      dockTargets,
    }),
    [
      lane,
      drag,
      locked,
      createLane,
      dissolveLane,
      evaluate,
      dock,
      undock,
      restored,
      registerDockTarget,
      dockTargets,
    ],
  );

  return <LaneContext.Provider value={api}>{children}</LaneContext.Provider>;
}

/**
 * 아직 **아무 단계도 끝나지 않은** 체인인가 — A″ 의 편집 허용 기준과 정렬.
 *
 * 생성 직후 진입 단계(0)는 running 이다: 서버가 kick 할 것이 없는 수동 단계라
 * (kick='manual') 사용자가 그 위젯을 직접 돌리고, 그 완료 훅이 체인을 전진시킨다.
 * 그래서 "실행 전" 의 정의는 *전 단계 pending* 이 아니라 **커서가 아직 0이고
 * 뒤 단계가 전부 pending** 이다.
 */
function isEditable(view: { currentStep: number; steps: { status: string }[] }): boolean {
  return (
    view.currentStep === 0 &&
    view.steps.slice(1).every((s) => s.status === 'pending')
  );
}

const INERT: LaneApi = {
  lane: null,
  drag: null,
  locked: false,
  createLane: () => {},
  dissolveLane: () => {},
  evaluate: () => ({ ok: false, error: 'unknown_step' }),
  setDrag: () => {},
  dock: () => {},
  undock: () => {},
  restored: [],
  laneBodyRef: { current: null },
  registerDockTarget: () => {},
  dockTargets: {},
};

export function useChainLane(): LaneApi {
  return useContext(LaneContext) ?? INERT;
}
