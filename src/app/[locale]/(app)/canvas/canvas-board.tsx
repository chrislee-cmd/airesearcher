'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. **팔레트 + 작업면** (캔버스 모듈화 Phase 1).

   SSOT: `design-handoff/canvas-modular/full/README.md` (§2 규칙 · 장면
   P0~P5 · §7 잔여 화면 · §9 레이어 · §11 Done-when).

   ── 멘탈 모델 (M0~M3 사용자 확정) ───────────────────────────────────────
   위젯은 **왼쪽 팔레트**에 있고, 작업면에는 **꺼낸 것만** 둔다. 제스처는
   뜻이 하나씩이다 — 끌기 = 체인에 조립, 누르기 = "그 위젯이 있는 곳으로".
   팔레트는 공급원이라 끌어가도 타일이 자리에서 빠지지 않는다(§2 규칙 1·2·3).

   ── 이 PR 에서 퇴역한 것 (같은 PR · M0a 확정) ───────────────────────────
   ① **그리드 캔버스** — 3×3 셀 배치·localStorage 좌표·셀 drop/swap·행별 헤더
      톤·발행 배치 적용·빈 셀 힌트. 위젯은 더 이상 작업면에 펼쳐 두지 않으므로
      "어느 셀에 있나" 라는 상태 자체가 없어진다.
   ② **위젯 Navigator** — 위젯별 상태 pill은 팔레트 타일 둘째 줄이, 포커스
      스크롤은 행 누르기(P1b)가 흡수했고, 숨김 eye 는 **개념이 소멸**했다
      (작업면에 안 꺼내면 안 보이는 것이 기본값 — WRITER-ANSWERS-SCENES).
      과도기 공존은 금지였다: 두 개가 같이 있으면 상태가 이중으로 표시된다.

   ── 카드는 항상 마운트돼 있고 보이지 않는다 ──────────────────────────────
   카드를 unmount 하면 라이브 세션(프로빙·통역)이 끊긴다. 그래서 모든 카드는
   **숨은 호스트**에 상시 마운트된다. 체인 인스펙터 PR 부터는 **레인으로 portal
   하지 않는다** — 레인 안은 240×300 요약 카드(`ChainStepCard`)가 그리고, 카드
   본체를 보는 경로는 "결과 보기 ↗"/"진행 보기 ↗" → 풀뷰다. 그 덕에 portal 이
   끌고 왔던 두 함정(합성 이벤트가 원래 트리로 버블 §8-2 · 숨은 래퍼
   `display:none` §8-3)이 이 표면에서 사라졌고, 포커스·키보드·선택 링은 레인에
   실제로 있는 요약 카드 노드가 들고 다닌다.

   ── 인스펙터는 밀어내기다 (체인 인스펙터 §4.1) ──────────────────────────
   오른쪽 400(좁은 화면 360) 패널은 팔레트와 같은 층 — `[data-canvas]` 의
   **형제**다. flex 형제라 열리면 캔버스 뷰포트가 그만큼 좁아진다(오버레이 0).
   레인의 캔버스 좌표는 그대로이고 보이는 창만 줄어들므로, 선택 카드가 그 창
   밖으로 밀렸을 **때만** 240ms 팬한다(줌은 바꾸지 않는다).

   ── 레이어 (§9 · 스펙 제약 4) ───────────────────────────────────────────
   팔레트는 `[data-canvas]` 의 **형제**다 — 캔버스 transform 밖(화면 고정)이고
   `[data-canvas-body]` cascade 밖이다. 고스트·툴팁·팝오버·온보딩은 body 포털
   `z-overlay`.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import { WidgetStatesMapProvider } from '@/components/canvas/shell/widget-state-context';
import { WidgetGateProvider } from '@/components/widget-gate-provider';
import { SidebarNav } from '@/components/canvas/shell/sidebar-nav';
import { FullviewShellProvider } from '@/components/canvas/shell/fullview-shell-context';
import {
  FullviewHeaderSlotProvider,
  useFullviewHeaderSlot,
} from '@/components/canvas/shell/fullview-header-slot-context';
import { FullviewShell } from '@/components/canvas/fullview/fullview-shell';
import { FullviewHeader } from '@/components/canvas/fullview/fullview-header';
import { WidgetGuideModal } from '@/components/canvas/widgets/widget-guide-modal';
import { widgetGuide } from '@/lib/widget-guides';
import { useViewMode } from '@/components/view-mode-provider';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import {
  resolveWidgetLabel,
  type WidgetContent,
} from '@/components/canvas/widget-types';
import { WidgetComingSoonGate } from '@/components/canvas/widgets/widget-coming-soon-gate';
import { ChainChip } from '@/components/canvas/chain/chain-chip';
import { useWidgetChain } from '@/components/canvas/chain/widget-chain-provider';
import { useChainLane } from '@/components/canvas/chain/chain-lane-provider';
import { ChainToolbarHost } from '@/components/canvas/chain/chain-toolbar-host';
import { ChainLaneHost } from '@/components/canvas/chain/chain-lane-host';
import {
  ChainInspector,
  INSPECTOR_W_NARROW,
  useInspectorWidth,
} from '@/components/canvas/chain/chain-inspector';
import { useChainInspector } from '@/components/canvas/chain/chain-inspector-provider';
import {
  CHAIN_STEP_WIDGET_KEY,
  type ChainStepFeature,
  type DockPosition,
} from '@/lib/chains/view';
import { PalettePanel } from '@/components/canvas/palette/palette-panel';
import { WorkspaceEmpty } from '@/components/canvas/palette/workspace-empty';
import { PaletteOnboarding } from '@/components/canvas/palette/palette-onboarding';
import {
  PaletteEmptyDropHint,
  PaletteGhost,
} from '@/components/canvas/palette/palette-portals';
import { usePaletteDrag } from '@/components/canvas/palette/use-palette-drag';

// 캔버스 pan/zoom — 그리드가 사라졌어도 **작업면은 여전히 pan/zoom 면**이다
// (레인 카드가 실치수 604×900 이라 한 체인이 뷰포트보다 넓다).
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.0;
const ZOOM_FACTOR = 1.03;
// FOCUS_THRESHOLD 0.55 — 이 scale 미만이면 "탐색 모드": 레인 카드 표면 아무
// 데나 클릭 = 그 카드로 focus 줌인(click-to-focus). 드래그 중에는 이 오버레이가
// pointer-events none 이 된다(§5 저줌 · LEARNINGS §2-1 · §8-8).
const FOCUS_THRESHOLD = 0.55;
/** 툴바는 화면 고정(§7 배치 — 캔버스 영역 기준 left 24 · top 20). */
const TOOLBAR_LEFT = 24;
const TOOLBAR_TOP = 20;
/**
 * 레인은 캔버스 안. 체인 인스펙터 `.dc.html` I0 의 실측 좌표(top 76 · left 16)
 * 를 쓴다 — 레인이 1168×~404 로 줄면서 옛 값(top 152 · left 24)은 (가) 아래로
 * 너무 내려가고 (나) 1440 에서 폭 예산을 8px 더 먹어 줌 100% fit 을 깨뜨린다.
 * 폭 예산: 1440 − 팔레트 240 = 1200 ≥ 16 + 1168 = 1184 ✓
 */
const LANE_TOP = 76;
const LANE_LEFT = 16;
/** 작업면 여백 — 레인 밖으로도 끌고 다닐 수 있는 숨 쉬는 공간. */
const WORKSPACE_PAD = 240;
/** surface 컨테이너의 top offset (pt-8). pan 식에 들어가므로 상수로 둔다. */
const SURFACE_PT = 32;
/** P1b — 레인 카드로 팬한 뒤 링을 띄우는 시간 (CSS `palette-ring` 1.2s + 여유). */
const RING_MS = 1400;
/** 레인이 없을 때의 실측값 — 상수라 파생 비교가 안정적이다. */
const ZERO_BOX = { w: 0, h: 0 };
/** sticky-left 가 헤더 내용을 밀 수 있는 한계 — 레인 오른쪽에 남겨 둘 폭. */
const STICKY_HEADER_MIN = 420;

// wheel target 의 가장 가까운 scrollable parent 를 찾는다. `data-canvas-surface`
// marker 에 도달하면 위젯 밖 (= 캔버스 surface) 으로 간주하고 null 반환 — 캔버스
// 자체 pan/zoom 처리. 위젯 안에서 overflow auto/scroll + 실제 스크롤 여유가 있는
// element 를 만나면 그것을 반환 — native browser scroll 양보.
function findScrollableParent(
  target: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== boundary) {
    if (el.dataset.canvasSurface !== undefined) return null;
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    const ox = style.overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// 셸 헤더(§F3) + 위젯 주입 액션 bridge. 셸의 <FullviewHeader> 는 제네릭
// 스캐폴드(타이틀·톤·닫기)만 소유하고, lang pill·End-session 등 위젯 종속
// 슬롯은 활성 위젯 body 가 FullviewHeaderSlot 로 publish → 여기서 구독해
// 헤더에 주입.
function FullviewHeaderConnected({
  title,
  tone,
  onClose,
}: {
  title: ReactNode;
  tone?: string;
  onClose?: () => void;
}) {
  const { projectPill, statusChip, actions, tabs } = useFullviewHeaderSlot();
  return (
    <FullviewHeader
      title={title}
      tone={tone}
      onClose={onClose}
      projectPill={projectPill}
      statusChip={statusChip}
      actions={actions}
      tabs={tabs}
    />
  );
}

export function CanvasBoard({
  widgets: rawWidgets,
  initialFocus,
  lockedKeys,
  hiddenBadgeKeys,
  orgId,
  userName,
  onboardingPending,
}: {
  widgets: WidgetContent[];
  /**
   * `?focus=<key>` 딥링크. 그리드가 퇴역해 "그 셀로 줌인" 이라는 목적지가 없어
   * **그 위젯의 풀뷰를 연다** — 누르기 규칙의 "위치 0개 → 새 풀뷰" 와 같은 뜻이고,
   * 기존 probing 딥링크가 이미 그렇게 동작했다.
   */
  initialFocus?: string;
  // 일반계정에서 준비중 게이트로 막을 위젯 key 목록 (서버 page 가 계산해 전달).
  lockedKeys?: string[];
  // 슈퍼어드민 전용 — 일반 유저에게 노출 off 된 위젯 key. 해당 카드에 "숨김"
  // 뱃지를 단다. 일반 유저에겐 빈 배열이라 뱃지 없음.
  hiddenBadgeKeys?: string[];
  // vote 저장 컨텍스트 — 활성 org id (nullable).
  orgId?: string | null;
  /** 팔레트 사용자 줄 (§4.1). 서버가 읽은 프로필 이름(없으면 이메일 local part). */
  userName?: string | null;
  /**
   * 전환 온보딩 대상자인가 (P4 · §8). 그리드 캔버스를 쓴 적 있는 사용자의 첫
   * 진입 1회만 true — 판정과 기록 모두 **사용자 단위 서버 플래그**라 기기가
   * 바뀌어도 다시 뜨지 않는다.
   */
  onboardingPending?: boolean;
}) {
  const hiddenBadgeSet = useMemo(
    () => new Set(hiddenBadgeKeys ?? []),
    [hiddenBadgeKeys],
  );
  // lockedKeys 에 든 위젯의 ExpandedBody 를 WidgetComingSoonGate 로 치환.
  const widgets = useMemo(() => {
    if (!lockedKeys || lockedKeys.length === 0) return rawWidgets;
    const locked = new Set(lockedKeys);
    return rawWidgets.map((w) =>
      locked.has(w.key)
        ? {
            ...w,
            dimmed: true,
            ExpandedBody: function LockedGate() {
              return (
                <WidgetComingSoonGate
                  widgetKey={w.key}
                  label={w.meta.label}
                  labelKey={w.meta.labelKey}
                  orgId={orgId}
                />
              );
            },
          }
        : w,
    );
  }, [rawWidgets, lockedKeys, orgId]);

  const widgetByKey = useMemo(
    () => Object.fromEntries(widgets.map((w) => [w.key, w])),
    [widgets],
  );

  // ── 공유 전체보기 (모달 / 리스트 상세) ──────────────────────────────
  const [fullviewOpen, setFullviewOpen] = useState(false);
  const [currentWidgetKey, setCurrentWidgetKey] = useState<string | null>(null);
  const [fullviewSlotEl, setFullviewSlotEl] = useState<HTMLElement | null>(
    null,
  );
  const { mode: viewMode } = useViewMode();
  const isList = viewMode === 'list';
  const tRoot = useTranslations();
  const tChain = useTranslations('Chain');
  const tDrag = useTranslations('Canvas.drag');
  const tPalette = useTranslations('Canvas.palette');
  const [listSlotEl, setListSlotEl] = useState<HTMLElement | null>(null);

  const openFullview = useCallback((key: string) => {
    setCurrentWidgetKey(key);
    setFullviewOpen(true);
  }, []);
  const switchFullview = useCallback((key: string) => {
    setCurrentWidgetKey(key);
  }, []);
  const closeFullview = useCallback(() => {
    setFullviewOpen(false);
  }, []);

  // ── 체인 / 레인 ─────────────────────────────────────────────────────
  const { view, hydrating, chipFor: chainChipFor } = useWidgetChain();
  const {
    lane,
    locked: laneLocked,
    setDrag: setLaneDrag,
    evaluate: evaluateDock,
    dock: dockCard,
    createLane,
    dockTargets,
    laneBodyRef,
  } = useChainLane();
  const { selectedIndex: inspectorIndex } = useChainInspector();
  const inspectorWidth = useInspectorWidth();
  const inspectorOpen = inspectorIndex !== null;

  /** 도킹된 위젯 key ← 단계 key. 레인 안에는 요약 카드가 그려진다. */
  const dockedKeys = useMemo(
    () =>
      new Map<string, ChainStepFeature>(
        (lane?.cards ?? []).map((f) => [CHAIN_STEP_WIDGET_KEY[f], f]),
      ),
    [lane],
  );

  /** 위젯 key → 체인 단계 key. 체인 미지원 위젯은 없다. */
  const stepOfWidget = useMemo(() => {
    const m = new Map<string, ChainStepFeature>();
    (Object.keys(CHAIN_STEP_WIDGET_KEY) as ChainStepFeature[]).forEach((f) => {
      if (!m.has(CHAIN_STEP_WIDGET_KEY[f])) m.set(CHAIN_STEP_WIDGET_KEY[f], f);
    });
    return m;
  }, []);

  const stepOfWidgetStrings = useMemo(
    () => new Map<string, string>(stepOfWidget),
    [stepOfWidget],
  );
  const dockedKeyStrings = useMemo(
    () => new Map<string, string>(dockedKeys),
    [dockedKeys],
  );
  /** 레인 카드 순서 — 팔레트가 단계 번호를 세는 폴백(서버 행 생성 전). */
  const laneCardKeys = useMemo<readonly string[]>(
    () => (lane?.cards ?? []).slice(),
    [lane],
  );
  const isChainable = useCallback(
    (key: string) => stepOfWidget.has(key),
    [stepOfWidget],
  );
  /** fit 칩 "→ n단계" — 지금 끌어 넣으면 몇 번째 카드가 되는가. */
  const nextStepNumber = (lane?.cards.length ?? 0) + 1;
  /** 레인이 있고 구성을 바꿀 수 있는가 — 드래그·fit 의 전제. */
  const laneActive = !!lane && !laneLocked;

  // ── pan / zoom ──────────────────────────────────────────────────────
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 레인 실측 — 작업면 크기가 레인에서 파생된다(그리드가 없으므로).
  const [laneEl, setLaneEl] = useState<HTMLDivElement | null>(null);
  const [laneBox, setLaneBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!laneEl) return;
    // ResizeObserver 는 observe 직후 1회 발화하므로 초기값도 여기서 들어온다
    // (effect 본문에서 동기 setState 하지 않는다 — react-hooks 규칙).
    const ro = new ResizeObserver(() =>
      setLaneBox({ w: laneEl.offsetWidth, h: laneEl.offsetHeight }),
    );
    ro.observe(laneEl);
    return () => ro.disconnect();
  }, [laneEl]);
  // 레인이 없으면 0 — **파생**으로 둔다(해체 때 effect 에서 되돌리면 그게
  // 곧 effect 안 동기 setState 다).
  const laneSize = laneEl ? laneBox : ZERO_BOX;

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setContainerSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 작업면 크기 — 레인을 담고 그 바깥으로 여백을 둔다. 레인이 없으면 컨테이너
  // 크기(= 팬할 것이 없는 빈 작업면).
  const SURFACE_W = Math.max(
    containerSize.w,
    laneSize.w + LANE_LEFT * 2 + WORKSPACE_PAD,
  );
  const SURFACE_H = Math.max(
    containerSize.h,
    LANE_TOP + laneSize.h + WORKSPACE_PAD,
  );

  // ── 팔레트 드래그 (P2) ──────────────────────────────────────────────
  const [paletteRect, setPaletteRect] = useState<DOMRect | null>(null);
  const onPaletteRectChange = useCallback(
    (rect: DOMRect | null) => setPaletteRect(rect),
    [],
  );
  const isPaletteRect = useCallback(
    (x: number, y: number) => {
      const r = paletteRect;
      if (!r) return false;
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    },
    [paletteRect],
  );

  /** P1b — 레인 카드로 팬 240ms + 링 1.2s + 포커스 이동. */
  const [ringKey, setRingKey] = useState<string | null>(null);
  const ringTimerRef = useRef(0);
  const focusLaneCard = useCallback(
    (widgetKey: string) => {
      const feature = dockedKeys.get(widgetKey);
      const container = containerRef.current;
      const target = feature ? dockTargets[feature] : null;
      if (!container || !target) return;
      const cr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      // 카드가 이미 화면 안이면 팬하지 않는다(P1b 이동).
      const visible =
        tr.left >= cr.left &&
        tr.right <= cr.right &&
        tr.top >= cr.top &&
        tr.bottom <= cr.bottom;
      if (!visible) {
        // pan 은 scale **앞**에 적용되므로 화면 좌표 델타가 곧 pan 델타다
        // (translate3d(pan) scale(zoom) — d(screen)/d(pan) = 1).
        const dx = cr.left + cr.width / 2 - (tr.left + tr.width / 2);
        const dy = cr.top + cr.height / 2 - (tr.top + tr.height / 2);
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      setRingKey(widgetKey);
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = window.setTimeout(() => {
        setRingKey(null);
        ringTimerRef.current = 0;
      }, RING_MS);
      // 포커스는 **레인 안에 실제로 있는 요약 카드**로. 위젯 카드 본체는 숨은
      // 호스트(display:none)에 있어 포커스가 가지 않는다(LEARNINGS §8-3).
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-chain-card-step="${widgetKey}"]`)
          // preventScroll 필수 — 아래 `onScroll` 주석 참고. 기본 focus 는
          // overflow:hidden 인 캔버스 컨테이너를 **스크롤**해 pan 과 좌표계를
          // 어긋나게 한다.
          ?.focus({ preventScroll: true });
      });
    },
    [dockedKeys, dockTargets],
  );

  const onDropped = useCallback(
    (widgetKey: string, _position: DockPosition) => {
      void _position;
      // 드롭 직후 포커스는 새 **요약 카드**로 (§5 키보드 완료 · P2d).
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-chain-card-step="${widgetKey}"]`)
          // preventScroll 필수 — 아래 `onScroll` 주석 참고. 기본 focus 는
          // overflow:hidden 인 캔버스 컨테이너를 **스크롤**해 pan 과 좌표계를
          // 어긋나게 한다.
          ?.focus({ preventScroll: true });
      });
    },
    [],
  );

  const panToLane = useCallback(() => {
    const container = containerRef.current;
    const body = laneBodyRef.current;
    if (!container || !body) return;
    const cr = container.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    if (br.top >= cr.top && br.bottom <= cr.bottom) return;
    setPan((p) => ({
      x: p.x,
      y: p.y + (cr.top + cr.height / 2 - (br.top + br.height / 2)),
    }));
  }, [laneBodyRef]);

  const dockByFeature = useCallback(
    (feature: string, position: DockPosition) => {
      dockCard(feature as ChainStepFeature, position);
    },
    [dockCard],
  );

  const paletteDrag = usePaletteDrag({
    laneActive,
    evaluate: evaluateDock,
    dock: dockByFeature,
    onDropped,
    onPanToLane: panToLane,
    isPaletteRect,
  });

  // 레인 슬롯이 수용/거절 외형을 그리려면 provider 의 `drag` 를 봐야 한다 —
  // 판정 소유자는 팔레트 드래그 훅 하나이고, 여기서 레인 쪽으로 **투영**만 한다
  // (두 곳이 각자 판정하면 슬롯이 말하는 사유와 고스트 라벨이 갈라진다).
  const pDrag = paletteDrag.drag;
  useEffect(() => {
    if (!pDrag) {
      // 언도킹 판정(카드 쪽)이 떠 있는 동안에는 지우지 않는다.
      setLaneDrag(null);
      return;
    }
    setLaneDrag({
      feature: pDrag.feature,
      over: pDrag.over,
      valid: !!pDrag.verdict?.ok,
      verdict: pDrag.verdict,
      undocking: null,
    });
  }, [pDrag, setLaneDrag]);

  // ── 전환 온보딩 (P4 · §8) ───────────────────────────────────────────
  const [onboardingOpen, setOnboardingOpen] = useState(!!onboardingPending);
  const dismissOnboarding = useCallback(() => {
    setOnboardingOpen((open) => {
      if (!open) return false;
      // 사용자 단위 서버 플래그 — 기기가 바뀌어도 재노출 0 (§11 Done-when).
      // 실패해도 이번 세션에서는 닫는다(안내가 다시 튀어나오는 쪽이 더 나쁘다).
      void fetch('/api/account/canvas-onboarding', { method: 'POST' }).catch(
        () => {},
      );
      return false;
    });
  }, []);

  // ── 위젯 영상 가이드 모달 ────────────────────────────────────────────
  const [guideKey, setGuideKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const openGuide = useCallback((key: string) => {
    setGuideKey(key);
    setGuideOpen(true);
  }, []);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
  }, []);

  const effectiveCurrentKey =
    currentWidgetKey ?? (isList ? (widgets[0]?.key ?? null) : null);
  const currentWidget = currentWidgetKey
    ? (widgetByKey[currentWidgetKey] ?? null)
    : null;
  const currentFullviewV2 = !!currentWidget?.meta.fullviewV2;

  const fullviewValue = useMemo(
    () => ({
      currentKey: effectiveCurrentKey,
      open: isList ? true : fullviewOpen,
      slotEl: isList ? listSlotEl : fullviewSlotEl,
      chrome: (isList ? 'page' : 'modal') as 'page' | 'modal',
      openFullview,
      switchTo: switchFullview,
      close: closeFullview,
    }),
    [
      effectiveCurrentKey,
      isList,
      listSlotEl,
      fullviewOpen,
      fullviewSlotEl,
      openFullview,
      switchFullview,
      closeFullview,
    ],
  );

  // 사이드바 단축키 1-N — 모달 open 시에만.
  useEffect(() => {
    if (!fullviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number.parseInt(e.key, 10) - 1;
        const target = widgets[idx];
        if (target) {
          e.preventDefault();
          setCurrentWidgetKey(target.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullviewOpen, widgets]);

  // ── 도킹 카드 키보드 언도킹 ────────────────────────────────────────
  // **레인 호스트로 이관했다.** 예전에는 `data-widget-node`(portal 되는 위젯
  // 카드)에 달려 있었는데, 요약 카드로 바뀌면서 그 노드가 숨은 호스트
  // (display:none)에만 남아 키보드가 영영 닿지 않는다(LEARNINGS §8-3 의 그
  // 함정). 판정(`evaluateUndock`)·실행(`undock`)·사유 표시가 모두 레인 안에
  // 있는 쪽이 맞으므로 `chain-lane-host` 가 소유한다.

  // ── 스페이스바 hold → pan 모드 ──────────────────────────────────────
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (el.hasAttribute('data-widget-node')) return true;
      if (el.hasAttribute('data-palette-handle')) return true;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setIsSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditableTarget(e.target)) return;
      setIsSpaceHeld(false);
    };
    const onBlur = () => setIsSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Figma/Miro 표준 wheel 분기 — native 리스너를 { passive: false } 로 붙여야
  // trackpad pinch / Cmd+wheel 의 브라우저 page zoom 을 확실히 막는다.
  const zoomRef = useRef(zoom);
  const panRefValue = useRef(pan);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRefValue.current = pan;
  }, [pan]);
  const isSpaceHeldRef = useRef(isSpaceHeld);
  useEffect(() => {
    isSpaceHeldRef.current = isSpaceHeld;
  }, [isSpaceHeld]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (findScrollableParent(e.target, container)) return;
      const isZoomGesture = e.ctrlKey || e.metaKey;
      e.preventDefault();
      if (isZoomGesture) {
        const currZoom = zoomRef.current;
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, currZoom * factor),
        );
        if (nextZoom === currZoom) return;
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = nextZoom / currZoom;
        const currPan = panRefValue.current;
        setPan({
          x: cx * (1 - ratio) + currPan.x * ratio,
          y: cy * (1 - ratio) + currPan.y * ratio,
        });
        setZoom(nextZoom);
        return;
      }
      setPan((p) => ({
        x: p.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: p.y - (e.shiftKey ? 0 : e.deltaY),
      }));
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isSpaceHeld) return;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [pan, isSpaceHeld],
  );

  const onMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    setPan({
      x: panRef.current.panX + (e.clientX - panRef.current.startX),
      y: panRef.current.panY + (e.clientY - panRef.current.startY),
    });
  }, []);

  const endPan = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  // 팬 종료는 **window pointerup** 으로 받는다. 컨테이너의 mouseleave 로
  // 끊으면 (가) 밖에서 손을 떼는 흔한 경로에서 팬이 멈추지 않고 (나) 캔버스
  // 표면에 enter/leave 리스너가 남아 §11 Done-when 의 "기하 판정만" 기계
  // 확인에 걸린다. 팬 중에만 청취한다.
  useEffect(() => {
    if (!isPanning) return;
    window.addEventListener('pointerup', endPan);
    window.addEventListener('pointercancel', endPan);
    return () => {
      window.removeEventListener('pointerup', endPan);
      window.removeEventListener('pointercancel', endPan);
    };
  }, [isPanning, endPan]);

  // click-to-focus 의 클릭 판정(pointerdown 좌표 · 이동거리)은 오버레이와 함께
  // 레인 호스트로 옮겼다 — 오버레이가 레인 안 요약 카드 위에 깔리기 때문이다.
  // 보드는 그 판정 결과를 `onFocusCard`(= focusCardZoom)로만 받는다.

  /** 저줌에서 레인 카드를 클릭하면 그 카드로 줌인 (click-to-focus). */
  const focusCardZoom = useCallback(
    (widgetKey: string) => {
      const feature = dockedKeys.get(widgetKey);
      const container = containerRef.current;
      const target = feature ? dockTargets[feature] : null;
      if (!container || !target) return;
      const cr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      if (tr.width === 0 || tr.height === 0) return;
      const PADDING = 0.85;
      // 지금 화면 크기에서 목표 줌으로 가는 비율 — rect 는 이미 줌이 반영된 값이다.
      const ratio = Math.min(
        (cr.width / tr.width) * PADDING,
        (cr.height / tr.height) * PADDING,
      );
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, zoom * ratio),
      );
      const scale = nextZoom / zoom;
      // 카드 중심을 컨테이너 중심에 맞춘다 — 줌 중심이 컨테이너 중심이므로
      // 새 pan = 중심 보정 + 기존 pan 의 스케일.
      const cardCx = tr.left + tr.width / 2 - cr.left;
      const cardCy = tr.top + tr.height / 2 - cr.top;
      setPan((p) => ({
        x: p.x + (cr.width / 2 - cardCx) * scale,
        y: p.y + (cr.height / 2 - cardCy) * scale,
      }));
      setZoom(nextZoom);
    },
    [dockedKeys, dockTargets, zoom],
  );

  // ── 레인 헤더 sticky-left (체인 인스펙터 §2) ─────────────────────────
  // CSS `position: sticky` 는 조상의 transform 을 모르므로 캔버스 팬에
  // 반응하지 않는다. 그래서 pan·zoom 에서 **캔버스 좌표계 오프셋**을 순수식으로
  // 계산해 레인에 내려준다(DOM 읽기·effect 0).
  //
  // 작업면은 컨테이너 가로 중앙에 놓이고 `transformOrigin: 'center top'` 이므로
  //   screenX(x_s) = (W_c − W_s)/2 + W_s/2 + pan.x + (x_s − W_s/2)·zoom
  //                = W_c/2 + pan.x + (x_s − W_s/2)·zoom
  // 레인 왼쪽(x_s = LANE_LEFT)의 화면 x 가 음수인 만큼이 "밀려난 양" 이다.
  //
  // **`useMemo` 를 쓰지 않는다.** 산술 3줄이라 메모할 값이 아니고, 메모로 두면
  // 팬 직후 오프셋이 옛 `pan.x` 에 묶여 0 으로 남는 것을 실측했다(프리뷰:
  // 레인이 −417 로 밀렸는데 헤더는 안 따라옴). 매 렌더 계산이 정답이다 —
  // 입력이 전부 같은 렌더의 값이라 DOM 과 어긋날 수 없다.
  const laneHeaderOffset = (() => {
    if (!lane || zoom <= 0 || containerSize.w === 0) return 0;
    const laneScreenLeft =
      containerSize.w / 2 + pan.x + (LANE_LEFT - SURFACE_W / 2) * zoom;
    if (laneScreenLeft >= 0) return 0;
    // 헤더 내용이 레인 오른쪽 끝을 넘지 않도록 묶는다 — 넘으면 "체인 1" 이
    // 레인 밖으로 나가 더 이상 그 레인의 머리로 읽히지 않는다.
    const limit = Math.max(0, laneSize.w - STICKY_HEADER_MIN);
    return Math.min(-laneScreenLeft / zoom, limit);
  })();

  // ── 인스펙터 열림/이동 시 팬 (§4.1 "가려질 때만") ────────────────────
  // 뷰포트가 400 좁아지면 선택 카드가 그 창 밖으로 밀릴 수 있다. **밀렸을
  // 때만** 창 가운데로 옮기고, 줌은 바꾸지 않는다. 측정이 필요하므로 effect 다
  // — 레이아웃(flex 축소)이 반영된 **뒤**에 rect 를 읽어야 해서 rAF 를 한 번
  // 거친다(LEARNINGS §8-8 의 "전이가 가라앉기 전 좌표" 함정과 같은 이유).
  //
  // **닫으면 밀어낸 만큼 되돌린다.** 창이 다시 넓어질 때 아무것도 안 하면 레인이
  // 오른쪽으로 치우친 채 남아 산출물 노드가 창 밖으로 잘린다(프리뷰 실측: 닫은
  // 뒤 레인 왼쪽이 +455). CD 가 닫힘 팬을 적지 않은 것은 "가려질 때만" 이 열림·
  // 이동의 규칙이기 때문이고, 그 규칙의 짝은 "밀어서 생긴 이동은 되돌린다" 다.
  // 사용자가 중간에 직접 팬했어도 **같은 델타만큼** 되돌리므로 상대 위치는
  // 유지된다(사용자 팬을 덮어쓰지 않는다).
  const inspectorPanRef = useRef(0);
  const selectedFeature =
    inspectorIndex === null ? null : (view?.steps[inspectorIndex]?.feature ?? null);
  useEffect(() => {
    if (!selectedFeature) {
      const applied = inspectorPanRef.current;
      inspectorPanRef.current = 0;
      if (applied !== 0) setPan((p) => ({ x: p.x - applied, y: p.y }));
      return;
    }
    const target = dockTargets[selectedFeature];
    const container = containerRef.current;
    if (!target || !container) return;
    const id = requestAnimationFrame(() => {
      const cr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      if (tr.width === 0) return;
      const visible = tr.left >= cr.left && tr.right <= cr.right;
      if (visible) return;
      const dx = cr.left + cr.width / 2 - (tr.left + tr.width / 2);
      inspectorPanRef.current += dx;
      setPan((p) => ({ x: p.x + dx, y: p.y }));
    });
    return () => cancelAnimationFrame(id);
  }, [selectedFeature, inspectorWidth, dockTargets]);

  // ── 초기 fit — 레인이 있으면 한눈에 들어오게 (mount 1회 latch) ───────
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (isList) return; // surface 가 display:none 이라 rect 가 0
    if (!lane || laneSize.w === 0 || containerSize.w === 0) return;
    didInitialFitRef.current = true;
    // rAF — 레인 생성 직후의 전이(0.28s)가 가라앉기 전에 좌표를 쓰면 엉뚱한
    // 곳에 안착한다(LEARNINGS §8-8). effect 본문 동기 setState 도 피한다.
    const id = requestAnimationFrame(() => {
      // 여백 16 — CD §2 "1440 에서 3단계가 줌 100% 로 가로 스크롤 없이".
      // 1200(캔버스) − 1168(레인) = 32 밖에 없으므로 옛 64 여백이면 fit 이
      // 0.92 로 떨어진다. MAX_ZOOM 이 1.0 이라 상한은 그대로 100% 다.
      const PADDING = 16;
      const boxW = laneSize.w;
      const boxH = laneSize.h;
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          (containerSize.w - PADDING * 2) / boxW,
          (containerSize.h - PADDING * 2) / boxH,
          MAX_ZOOM,
        ),
      );
      // surface 는 flex 로 컨테이너 가로 중앙 배치 + transformOrigin 'center top'.
      const boxCx = LANE_LEFT + boxW / 2;
      const boxCy = LANE_TOP + boxH / 2;
      setZoom(fitZoom);
      setPan({
        x: (SURFACE_W / 2 - boxCx) * fitZoom,
        y: containerSize.h / 2 - SURFACE_PT - boxCy * fitZoom,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [isList, lane, laneSize, containerSize, SURFACE_W]);

  // mount 시 `?focus=` 딥링크 → 그 위젯의 풀뷰. URL 은 즉시 정리한다 — 남아
  // 있으면 사용자가 모달을 페이지로 오인하고 백버튼으로 캔버스를 떠난다.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    didInitialFocusRef.current = true;
    if (!initialFocus || !widgetByKey[initialFocus]) return;
    const id = requestAnimationFrame(() => {
      openFullview(initialFocus);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('focus');
        const next = url.pathname + (url.search || '') + url.hash;
        window.history.replaceState(window.history.state, '', next);
      } catch {
        /* URL 조작 실패 — 모달은 open, URL 만 더러운 채로 진행 */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [initialFocus, widgetByKey, openFullview]);

  // pan 모드 cursor 강제 — JSX 안 <style> 은 매 렌더 flicker 를 만들어(#391)
  // document.head 에 한 번만 주입한다.
  useEffect(() => {
    if (!isPanning && !isSpaceHeld) return;
    const cursor = isPanning ? 'grabbing' : 'grab';
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.cursor = cursor;
    const styleEl = document.createElement('style');
    styleEl.dataset.canvasPanCursor = '';
    styleEl.textContent = `*, *::before, *::after { cursor: ${cursor} !important; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.body.style.cursor = prevBodyCursor;
      styleEl.remove();
    };
  }, [isPanning, isSpaceHeld]);

  useEffect(
    () => () => {
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
    },
    [],
  );

  const ghostWidget = pDrag ? widgetByKey[pDrag.widgetKey] : null;
  const ghostLabel = useMemo(() => {
    if (!pDrag || pDrag.mode !== 'pointer' || pDrag.over === null) return null;
    if (pDrag.verdict?.ok) {
      return {
        text: tChain('dock.ghostValid', { n: nextStepNumber }),
        valid: true,
      };
    }
    return { text: tChain('dock.ghostInvalid'), valid: false };
  }, [pDrag, tChain, nextStepNumber]);

  return (
    <WidgetStatesMapProvider>
    <WidgetGateProvider>
    <FullviewShellProvider value={fullviewValue}>
    <FullviewHeaderSlotProvider>
    {/* 팔레트와 작업면 — 팔레트는 `[data-canvas]` 의 **형제**다(제약 4 · §9). */}
    <div
      className="flex h-full min-h-0"
      style={{ display: isList ? 'none' : undefined }}
    >
      <PalettePanel
        widgets={widgets}
        userName={userName ?? null}
        laneActive={laneActive}
        view={view}
        dockedSteps={dockedKeyStrings}
        laneCards={laneCardKeys}
        stepOfWidget={stepOfWidgetStrings}
        nextStepNumber={nextStepNumber}
        isChainable={isChainable}
        drag={paletteDrag}
        onOpenWidget={openFullview}
        onFocusLaneCard={focusLaneCard}
        onFirstInteraction={dismissOnboarding}
        onRectChange={onPaletteRectChange}
      />

      <div
        ref={containerRef}
        data-canvas
        // 드래그 중에만 click-to-focus 오버레이를 투과시킨다(§5 저줌).
        data-palette-dragging={pDrag && !pDrag.returning ? 'true' : undefined}
        className="relative h-full min-w-0 flex-1 overflow-hidden"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        // 캔버스는 **스크롤 컨테이너가 아니다** — 위치는 오직 `pan`/`zoom` 이
        // 소유한다. 그런데 `overflow: hidden` 박스도 브라우저가 **프로그램적으로
        // 스크롤**할 수 있다: `focus()`·`scrollIntoView` 가 화면 밖 자손을
        // 가져오려고 숨은 스크롤을 움직인다. 그러면 DOM 은 움직였는데 `pan` 은
        // 그대로라 **좌표계가 조용히 어긋난다** — 레인 헤더 sticky-left 가 팬
        // 뒤 멈춰 보이던 실측 결함의 진짜 원인이 이것이었다(오프셋 식은 pan 을
        // 보는데 레인은 숨은 스크롤로 밀려 있었다). 그래서 0 으로 되돌린다.
        // 포커스 이동은 `focus({ preventScroll: true })` 로 애초에 안 밀고,
        // 이 핸들러는 그 밖의 경로(브라우저 내부 scrollIntoView 등)의 백스톱이다.
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollLeft !== 0) el.scrollLeft = 0;
          if (el.scrollTop !== 0) el.scrollTop = 0;
        }}
      >
        {/* 툴바 — 화면 고정(변환 레이어 밖). Navigator 가 사라져 좌상단 충돌이
            없어졌으므로 CD 좌표(left 24 · top 20)를 그대로 쓴다(§7 배치). */}
        <div
          style={{ left: TOOLBAR_LEFT, top: TOOLBAR_TOP }}
          // z-overlay — 저줌에서 카드마다 깔리는 click-to-focus 오버레이와 같은
          // 층이어야 "+ 새 체인" 이 묻히지 않는다(LEARNINGS §2-1).
          className="pointer-events-none absolute z-overlay"
        >
          <ChainToolbarHost onFocusLane={panToLane} />
        </div>

        {/* P3a 빈 작업면 — 레인이 없을 때. 요약 pill 도, 옛 그리드 자리표시도
            그리지 않는다(§7 P3a).

            `hydrating`(체인 첫 조회) 중에는 띄우지 않는다. 그 구간은 "레인이
            있는지 **모르는** 구간" 이라, (가) 복원될 레인 위에 "비어 있어요" 가
            한 번 깜빡이고 (나) 그 사이 CTA 를 누르면 복원될 레인 위에 빈 레인을
            덮어쓴다(LEARNINGS §9 — 돌고 있는 체인을 가리는 그 경로). 툴바가
            같은 이유로 `busy={hydrating}` 로 잠긴다. */}
        {!lane && !hydrating && <WorkspaceEmpty onNewChain={createLane} />}

        <div className="absolute inset-0 flex items-start justify-center pt-8">
          <div
            data-canvas-surface
            // shrink-0 필수 — 자식이 absolute 라 min-content 폭이 0이고,
            // flex-shrink 기본 1 이면 surface 실폭이 컨테이너로 줄어 'center top'
            // 의 center 가 SURFACE_W/2 가 아니게 되어 pan 계산이 전부 어긋난다.
            className="relative shrink-0"
            style={{
              width: SURFACE_W,
              height: SURFACE_H,
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: 'center top',
              // P1b 이동 = 240ms ease-out (팬 중에는 전이 없음).
              transition: isPanning ? 'none' : 'transform 240ms ease-out',
            }}
          >
            {lane && (
              <div
                ref={setLaneEl}
                data-chain="lane-row"
                className="absolute"
                // 레인은 작업면 폭 안에 머문다 — 체인이 길어지면 레인 **본문이**
                // 가로로 스크롤된다(v3 결정 1). 폭 제한이 없으면 inline-flex 가
                // 내용만큼 늘어나 overflow-x-auto 가 영영 걸리지 않는다.
                style={{
                  top: LANE_TOP,
                  left: LANE_LEFT,
                  maxWidth: SURFACE_W - LANE_LEFT * 2,
                }}
              >
                <ChainLaneHost
                  onOpenWidget={openFullview}
                  narrow={inspectorOpen && inspectorWidth === INSPECTOR_W_NARROW}
                  headerOffset={laneHeaderOffset}
                  lowZoom={zoom < FOCUS_THRESHOLD}
                  panMode={isSpaceHeld}
                  onFocusCard={focusCardZoom}
                  ringWidgetKey={ringKey}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 인스펙터 — 팔레트와 같은 층(`[data-canvas]` 의 형제). flex 형제라
          열리면 캔버스가 그만큼 좁아진다 = 밀어내기(§4.1 오버레이 0). */}
      <ChainInspector onOpenFullview={openFullview} width={inspectorWidth} />
    </div>

    {/* ── 카드 호스트 — 항상 마운트, 보이지 않음 ────────────────────────
        위젯은 **꺼낸 것만** 작업면에 보인다(§2 규칙 3 · P3c). 카드를 unmount
        하면 라이브 세션(프로빙·통역)이 끊기므로 여기에 상시 마운트해 둔다.
        체인 인스펙터 PR 부터 **레인으로 portal 하지 않는다** — 레인 안은 요약
        카드가 그리고, 본체는 풀뷰에서 본다. 그래서 여기 노드는 순수한 "살아
        있는 세션의 거처" 이고 포커스·키보드 대상이 아니다. */}
    <div data-canvas-card-host style={{ display: 'none' }}>
      {widgets.map((w) => {
        const dockFeature = dockedKeys.get(w.key);
        return (
          <div
            key={w.key}
            data-widget-node={w.key}
            data-chain-docked={dockFeature ? 'true' : 'false'}
            aria-label={tRoot(`Sidebar.${w.key}`)}
            className={`relative h-full ${w.dimmed ? 'opacity-50' : ''}`}
          >
            <WidgetShell
              content={w}
              dashboardMode
              // 체인 칩 — 체인에 묶인 카드만 슬롯을 받는다(비체인 카드는
              // undefined → 서브바 행 자체가 안 그려진다). 셸의 subbarEnd 는
              // 바디 래퍼 **밖**이라 cascade 함정이 없다(LEARNINGS §5).
              subbarEnd={(() => {
                const chip = chainChipFor(w.key);
                return chip ? <ChainChip {...chip} /> : undefined;
              })()}
              onFullview={() => openFullview(w.key)}
              hasGuide={widgetGuide(w.key) != null}
              onGuide={openGuide}
            />
            {/* "숨김" 뱃지 — 슈퍼어드민 캔버스에서 일반 유저에게 노출 off 인
                위젯 표시. 일반 유저는 set 이 비어 미노출. */}
            {hiddenBadgeSet.has(w.key) && (
              <div className="pointer-events-none absolute top-3 right-3 z-fab">
                <Badge variant="subtle" size="sm">
                  {tRoot('Shell.hidden')}
                </Badge>
              </div>
            )}
            {/* click-to-focus 오버레이는 **레인 안 요약 카드** 위로 옮겼다 —
                여기 노드는 display:none 이라 포인터가 닿지 않는다. 레인 호스트
                가 `lowZoom`/`onFocusCard` 로 같은 동작을 그린다(§9 저줌 규칙:
                첫 클릭 = 포커스 줌인 · 둘째부터 인스펙터). */}
          </div>
        );
      })}
    </div>

    {/* ── 팔레트 포털 레이어 (§9) ──────────────────────────────────── */}
    {pDrag && pDrag.mode === 'pointer' && pDrag.ghost && ghostWidget && (
      <PaletteGhost
        x={pDrag.ghost.x}
        y={pDrag.ghost.y}
        returning={pDrag.returning}
        widgetKey={ghostWidget.key}
        name={resolveWidgetLabel(tRoot, ghostWidget.meta)}
        credits={
          typeof ghostWidget.meta.cost === 'number'
            ? tPalette('credits', { n: ghostWidget.meta.cost })
            : tPalette('creditsNone')
        }
        accent={ghostWidget.meta.accent}
        label={ghostLabel}
      />
    )}
    {paletteDrag.emptyHint && (
      <PaletteEmptyDropHint
        x={paletteDrag.emptyHint.x}
        y={paletteDrag.emptyHint.y}
        text={tDrag('emptyDropHint')}
      />
    )}
    {onboardingOpen && !isList && paletteRect && (
      <PaletteOnboarding
        anchorX={paletteRect.right}
        anchorY={paletteRect.top + 92}
        onDismiss={dismissOnboarding}
      />
    )}

    {/* ── 리스트 뷰 (풀페이지 셸) ─────────────────────────────────────
        캔버스 보드 없이 좌 SidebarNav + 우 단일 위젯 상세. 상세 slot 은
        (숨겨졌지만 계속 마운트된) 카드 본문이 portal 되는 대상이다. */}
    {isList && (
      <div data-canvas-list className="flex h-full min-h-0 overflow-hidden">
        <SidebarNav
          widgets={widgets}
          current={effectiveCurrentKey}
          onSwitch={switchFullview}
          lockedKeys={lockedKeys}
        />
        <div
          ref={setListSlotEl}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        />
      </div>
    )}

    {/* ── 공유 전체보기 모달 (레거시 경로) ─────────────────────────── */}
    {!currentFullviewV2 && (
      <Modal
        open={!isList && fullviewOpen && !!currentWidgetKey}
        onClose={closeFullview}
        size="wide"
      >
        <div className="flex h-full min-h-0 flex-1 overflow-hidden">
          <SidebarNav
            widgets={widgets}
            current={currentWidgetKey}
            onSwitch={switchFullview}
            lockedKeys={lockedKeys}
          />
          <div
            ref={setFullviewSlotEl}
            className="flex min-w-0 flex-1 flex-col overflow-hidden"
          />
        </div>
      </Modal>
    )}

    {/* ── 공유 전체보기 셸 V2 (fullviewV2 opt-in 위젯) ──────────────── */}
    {currentFullviewV2 && currentWidget && (
      <FullviewShell
        open={!isList && fullviewOpen && !!currentWidgetKey}
        onClose={closeFullview}
        widgets={widgets}
        activeKey={currentWidgetKey}
        onSwitch={switchFullview}
        lockedKeys={lockedKeys}
        tall={currentWidget.meta.fullviewTall}
        footnote={
          currentWidget.meta.fullviewFootnoteKey
            ? tRoot(currentWidget.meta.fullviewFootnoteKey)
            : undefined
        }
        header={
          <FullviewHeaderConnected
            title={resolveWidgetLabel(tRoot, currentWidget.meta)}
            tone={`var(--widget-header-bg-${currentWidget.meta.accent})`}
            onClose={closeFullview}
          />
        }
      >
        <div
          ref={setFullviewSlotEl}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        />
      </FullviewShell>
    )}

    {/* ── 위젯 영상 가이드 모달 ─────────────────────────────────────── */}
    {(() => {
      const gw = guideKey ? (widgetByKey[guideKey] ?? null) : null;
      const g = guideKey ? widgetGuide(guideKey) : null;
      return (
        <WidgetGuideModal
          open={guideOpen}
          onClose={closeGuide}
          guide={g}
          widgetName={gw ? resolveWidgetLabel(tRoot, gw.meta) : ''}
          accent={gw?.meta.accent ?? 'sky'}
        />
      );
    })()}
    </FullviewHeaderSlotProvider>
    </FullviewShellProvider>
    </WidgetGateProvider>
    </WidgetStatesMapProvider>
  );
}
