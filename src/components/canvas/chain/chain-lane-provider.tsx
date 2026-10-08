'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLaneProvider — 레인의 클라이언트 상태 + 도킹 판정 + 서버 체인 동기화.

   CD SSOT: `v3/README.md` State·Interactions. 상태 모양도 CD 그대로:
     lane: { cards: feature[], originIndex: Record<feature, Coords> } | null
     drag: { feature, over: slotIndex | null, valid, reason } | null

   ── 설계 결정 2가지 (writer 확정 2026-10-08) ──────────────────────────
   1) **수명주기**: 레인이 유효(2단계+ compat)해지는 순간 서버 체인을 POST 한다.
      B 의 advance 훅이 진입 위젯 완료 시 체인을 찾으려면 row 가 먼저 있어야 한다.
   2) **조립 변경**은 `syncComposition()` **함수 하나로 추상화**한다 — 호출부
      (dock/undock)는 서버 전이를 모른다. A″(`pr-chain-steps-patch`) 머지로 이
      함수 내부가 cancel+재생성 → **`PATCH /api/chains/:id/steps` 1회**로 바뀌었다
      (호출부 무변경). 종결(error/done/cancelled) 체인의 "같은 구성 재실행" 은
      편집이 아니라 **새 체인 POST** 다.

   ── 수정 가능 판정은 백엔드와 정렬한다 (A″ `isAssemblyEditable`) ──────────
   판정 권위는 서버다. 프론트는 같은 술어의 **관측 가능한 부분**만 복제해
   낙관적으로 UI 를 잠그고(헤더 문구·툴바), 실제 거절은 **409 `chain_locked`**
   로 받아 갱신된 상태를 다시 읽는다(경합 시 상대 1승 — 재시도 없음).

   그래서 생성 시 **자동 승인을 하지 않는다**: `isAssemblyEditable` 은
   `status='awaiting_approval'` 을 요구하므로, v1/v2 처럼 생성 직후 승인하면
   조립이 그 즉시 잠겨 CD L3 의 "양 끝에서 빼기" 가 불가능해진다.

   ⚠️ 알려진 틈 (B 쪽 후속 1건): `advance.findChainAtStep` 은 `status='running'`
   체인만 채택하므로, `awaiting_approval` 로 대기 중인 진입 단계는 위젯 세션이
   끝나도 전진하지 않는다. CD L3→L4 전이("세션이 끝나면 시작")에는 advance 가
   `awaiting_approval` + 커서 단계 일치 + `job_ref` 없음인 행도 채택하며
   running 으로 올리는 경로가 필요하다. 그 채택은 `status` 를 **바꾸므로**
   A″ 의 CAS(`status='awaiting_approval'` + `updated_at`)로 PATCH 와 선후를
   가를 수 있다 — auto 모드에서 CAS 로 못 가렸던 구간과 다르다.

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
  const { view, createChain, patchSteps, cancel, refresh } = useWidgetChain();
  const [lane, setLane] = useState<LaneState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [restored, setRestored] = useState<string[]>([]);
  const [dockTargets, setDockTargets] = useState<Record<string, HTMLElement | null>>({});
  const laneBodyRef = useRef<HTMLDivElement | null>(null);

  // 구성 잠금 — CD Interactions 는 `{running, awaiting_approval, paused}` 로
  // 적었지만, 그건 **체인이 실행 시점에야 생긴다는 v2 전제**에서 쓰인 집합이다.
  // v3 는 조립이 끝나는 순간 체인을 만들므로(수명주기 (가)) 그 집합을 그대로
  // 쓰면 **조립 직후부터 구성이 잠겨** L3 의 "양 끝에서 빼기" 가 불가능해진다.
  // 그래서 백엔드 `isAssemblyEditable` 과 같은 기준(실행 흔적 유무)으로 잠근다.
  // 종결 상태(error/done/cancelled)도 CD 대로 잠금이 풀린다 — 그쪽은 편집이
  // 아니라 새 체인 POST 경로다.
  const locked = !!view && !isEditable(view) && !isTerminal(view.status);

  /**
   * 조립 결과를 서버에 반영한다 — **교체 지점은 여기 하나뿐**이다.
   * A″(PATCH steps) 머지 후에는 이 함수 내부만 바뀐다(인터페이스 불변).
   */
  const syncComposition = useCallback(
    async (cards: ChainStepFeature[]) => {
      // 2단계 미만은 아직 체인이 아니다 — 서버에 만들지 않는다(초안).
      // PATCH 는 `too_short` 로 거절하므로(validateSteps) 여기서 갈라야 한다.
      if (cards.length < 2) {
        // 이미 만들어 둔 실행 전 체인이 있으면 거둬들인다.
        if (view && isEditable(view)) await cancel();
        return;
      }
      if (!view) {
        await createChain({ steps: cards });
        return;
      }
      // 실행 흔적이 없는 체인 = 조립 수정(A″ PATCH). 409 면 patchSteps 가
      // 갱신된 상태를 다시 읽고 false 를 돌려준다 — 여기서 재시도하지 않는다.
      if (isEditable(view)) {
        await patchSteps(cards);
        return;
      }
      // 종결 체인에서 구성을 바꾸면 그건 편집이 아니라 새 체인이다.
      await createChain({ steps: cards });
    },
    [view, createChain, patchSteps, cancel],
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
 * 조립을 수정할 수 있는 체인인가 — 백엔드 `isAssemblyEditable`(state.ts)의 미러.
 *
 * 서버 술어: `status='awaiting_approval'` · `current_step=0` · 모든 단계에
 * `job_ref` 없음 · 진행 마킹(done/skipped/error/running) 없음. 그중 `job_ref` 는
 * `ChainView` 에 없으므로(표시에 쓰이지 않음) **관측 가능한 부분만** 복제한다 —
 * 즉 이 함수는 서버보다 **느슨할 수 있고**, 그 간극은 409 `chain_locked` 가 닫는다.
 * 판정을 여기서 재발명하지 않는 이유: 두 곳의 규칙이 갈라지는 순간 사용자가 본
 * 체인과 실제로 도는 체인이 달라진다(A″ LEARNINGS §2 와 같은 류의 사고).
 *
 * `status` 가 `awaiting_approval` 인 것이 핵심이다 — auto 모드(생성 즉시
 * `running`)는 advance 의 채택 구간과 CAS 로 구분할 수 없어 서버가 아예 수정
 * 대상에서 제외한다(A″ LEARNINGS §3). 그래서 auto 레인은 조립 후 잠긴다.
 */
function isEditable(view: {
  status: string;
  currentStep: number;
  steps: { status: string }[];
}): boolean {
  if (view.status !== 'awaiting_approval') return false;
  if (view.currentStep !== 0) return false;
  if (view.steps.length === 0) return false;
  return view.steps.every((s, i) =>
    i === 0
      ? s.status === 'awaiting_approval' || s.status === 'pending'
      : s.status === 'pending',
  );
}

/** 종결 체인 — 구성 변경이 "편집" 이 아니라 새 체인 POST 인 상태. */
function isTerminal(status: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
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
