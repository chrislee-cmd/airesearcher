'use client';

/* ────────────────────────────────────────────────────────────────────
   PalettePanel — 팔레트 컨테이너 (펼침 240 / 접힘 72).

   CD SSOT: `canvas-modular/full/README.md` §4.1 · §4.2 · §4.3 · §6 ·
   장면 P0 · P1a · P1b · P3a~P3c.

   ── 로스터는 발행 SSOT 에서 온다 (§2 규칙 5) ─────────────────────────────
   `widgets` prop 이 곧 로스터다. 서버(`canvas/page.tsx`)가
   `CANVAS_ORDER × widget_visibility`(+ preview 게이트)로 이미 걸러 **그 순서
   그대로** 내려주므로, 이 컴포넌트는 9종을 세지도 하드코딩하지도 않는다.
   미발행 위젯은 회색으로 남기지 않고 목록에 아예 없다.

   ── 팔레트는 `[data-canvas]` 의 형제다 (스펙 제약 4 · §9) ────────────────
   캔버스 transform 밖이라 줌·팬과 무관하게 화면에 고정되고,
   `[data-canvas-body]` cascade 가 닿지 않아 native button 함정·`.text-xl`
   함정을 겪지 않는다(LEARNINGS §5). 그래서 여기서는 셸 opt-out 이 필요 없다.

   ── hover 는 좌표 판정이다 (§2 규칙 6) ──────────────────────────────────
   `mouseenter/leave` 를 쓰지 않는다. 팔레트 위에서 pointermove 가 한 번
   오면 window 리스너를 켜고(rAF 스로틀), 포인터가 팔레트 rect 를 벗어나는
   프레임에 스스로 끈다 — "필요할 때만 청취" 와 "enter/leave 0" 을 동시에
   만족한다. 판정 결과(hover 중인 타일 key + 그 rect)가 타일·툴팁의 **단일
   소스**다.

   ── 누르기 = 위치 개수로 갈린다 (§6 · P5 ②) ─────────────────────────────
   0개 → 새 풀뷰 · 1개 → 그 위치로 · 2개 이상 → 작업 목록 펼침.
   시스템이 대신 고르지 않는다.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { josa } from '@/lib/korean-particle';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { widgetIconFor } from '@/components/canvas/shell/widget-icon';
import { ACCENT_BG } from '@/components/canvas/shell/tokens';
import {
  resolveWidgetLabel,
  type WidgetContent,
} from '@/components/canvas/widget-types';
import { useWidgetStateOf } from '@/components/canvas/shell/widget-state-context';
import { dockReason } from '@/components/canvas/chain/chain-lane-host';
import type { ChainView } from '@/lib/chains/view';
import {
  isDraggable,
  leadLocation,
  locationsOf,
  pulsesFor,
  tileVisualState,
  toneOf,
  type LocationStatus,
  type WidgetLocation,
} from './palette-model';
import { PaletteTile, type PaletteTileSecondLine } from './palette-tile';
import { PaletteWorkList, WORK_LIST_MAX_ROWS, type WorkListRow } from './palette-work-list';
import { PaletteRailPopover, PaletteRailTooltip } from './palette-portals';
import type { PaletteDragApi } from './use-palette-drag';

/** 접힘 레일 폭 (§4.1 접힘). 토큰이 아니다 — 레일은 카드 형태라 레이아웃 상수. */
const RAIL_W = 72;
/** 뷰포트가 이보다 좁으면 자동으로 접힌다 (§4.1 접힘 조건). */
const AUTO_COLLAPSE_VW = 1280;
/** 사용자가 직접 접거나 펼친 선택 — 기기 단위 설정(§4.1 "사용자 설정으로 기억"). */
const COLLAPSE_STORAGE_KEY = 'canvas:palette-collapsed:v1';

const STATUS_KEY: Record<LocationStatus, string> = {
  error: 'statusError',
  paused: 'statusPaused',
  awaiting: 'statusAwaiting',
  running: 'statusRunning',
  pending: 'statusPending',
  done: 'statusDone',
};

const RAIL_DOT: Record<string, string> = {
  ok: 'bg-soft-ok-dot',
  run: 'bg-soft-run-dot',
  warn: 'bg-soft-warn-dot',
  err: 'bg-soft-err-dot',
  idle: 'bg-soft-faint',
};

type Hover = { key: string; rect: DOMRect } | null;

export type PalettePanelProps = {
  /** 로스터 = 발행 SSOT 순서 그대로 (하드코딩 0). */
  widgets: WidgetContent[];
  /** 레인이 있고 구성을 바꿀 수 있는가 — fit 상태·드래그 가능 판정. */
  laneActive: boolean;
  /** 서버 체인 투영 — 레인 카드 위치의 상태 출처(LEARNINGS §9). */
  view: ChainView | null;
  /** 위젯 key → 레인에 들어 있는 단계 key. */
  dockedSteps: Map<string, string>;
  /** 레인 카드 순서 — 단계 번호의 폴백(1장일 땐 서버 행이 아직 없다). */
  laneCards: readonly string[];
  /** 위젯 key → 체인 단계 key (체인 미지원이면 undefined). */
  stepOfWidget: Map<string, string>;
  /** 다음에 들어갈 단계 번호 — fit 칩 "→ n단계". */
  nextStepNumber: number;
  /** 체인 지원 위젯인가 — "체인" 칩(§4.2 idle). */
  isChainable: (widgetKey: string) => boolean;
  drag: PaletteDragApi;
  /** 위치 0개 누르기 / 풀뷰 행 누르기 → 새 풀뷰. */
  onOpenWidget: (widgetKey: string) => void;
  /** 레인 카드 위치 누르기 → 팬 240ms + 링 1.2s + 포커스 이동 (P1b). */
  onFocusLaneCard: (widgetKey: string) => void;
  /** 타일을 처음 누르거나 끌 때 — 온보딩을 닫는다(§8 닫힘). */
  onFirstInteraction: () => void;
  /** 팔레트 rect 를 호출부(보드)가 알아야 한다 — 취소 사유 구분·온보딩 위치. */
  onRectChange: (rect: DOMRect | null) => void;
};

export function PalettePanel({
  widgets,
  laneActive,
  view,
  dockedSteps,
  laneCards,
  stepOfWidget,
  nextStepNumber,
  isChainable,
  drag,
  onOpenWidget,
  onFocusLaneCard,
  onFirstInteraction,
  onRectChange,
}: PalettePanelProps) {
  const t = useTranslations('Canvas.palette');
  const tDrag = useTranslations('Canvas.drag');
  // 거절 사유는 레인과 **같은 함수**로 조립한다(`dockReason`) — 문구를
  // 복제하면 슬롯이 말하는 사유와 aria-live 가 갈라진다.
  const tChainRaw = useTranslations('Chain');
  const tRoot = useTranslations();

  const rootRef = useRef<HTMLElement | null>(null);

  // ── 접힘 ───────────────────────────────────────────────────────────
  // 사용자 선택이 있으면 그것이 이기고, 없으면 뷰포트가 정한다(§4.1).
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let stored: boolean | null = null;
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw === 'true') stored = true;
      else if (raw === 'false') stored = false;
    } catch {
      /* private mode — 뷰포트 규칙만 쓴다 */
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate stored preference on mount (positions/use-hidden-defaults 와 동일 패턴)
    setUserCollapsed(stored);
  }, []);

  useEffect(() => {
    const sync = () => setNarrow(window.innerWidth < AUTO_COLLAPSE_VW);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const collapsed = userCollapsed ?? narrow;

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed((curr) => {
      const next = !(curr ?? narrow);
      if (hydratedRef.current) {
        try {
          window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
        } catch {
          /* quota / private mode — 이번 세션만 적용 */
        }
      }
      return next;
    });
  }, [narrow]);

  // ── 좌표 판정 hover (§2 규칙 6) ────────────────────────────────────
  const [tracking, setTracking] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const lastRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);

  // 포인터 좌표 하나로 "지금 어느 타일 위인가" 를 판정한다. 팔레트 rect 를 먼저
  // 보고(싼 검사) 벗어났으면 청취를 끈다 — "필요할 때만 청취".
  const flushHover = useCallback(() => {
    rafRef.current = 0;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { x, y } = lastRef.current;
    const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (!inside) {
      setHover(null);
      setTracking(false);
      return;
    }
    let hit: Hover = null;
    el.querySelectorAll<HTMLElement>('[data-palette-tile]').forEach((tile) => {
      if (hit) return;
      const tr = tile.getBoundingClientRect();
      if (x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom) {
        const key = tile.dataset.paletteTile;
        if (key) hit = { key, rect: tr };
      }
    });
    setHover(hit);
  }, []);

  const scheduleHover = useCallback(() => {
    // rAF 스로틀 — rect 읽기를 프레임당 1회로 묶는다.
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(flushHover);
  }, [flushHover]);

  useEffect(() => {
    if (!tracking) return;
    const onMove = (e: PointerEvent) => {
      lastRef.current = { x: e.clientX, y: e.clientY };
      scheduleHover();
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [tracking, scheduleHover]);

  // **이 핸들러도 판정을 예약한다.** 예약 없이 `tracking` 만 켜면, 팔레트에
  // 처음 들어온 pointermove 가 window 리스너가 붙기 **전** 이벤트라 그 프레임이
  // 영영 flush 되지 않는다 → 포인터가 한 번 더 움직여야 hover 가 켜진다
  // (프리뷰 오라클 실측: 첫 타일만 hover=null 로 남아 fit 칩이 안 떴다).
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      lastRef.current = { x: e.clientX, y: e.clientY };
      setTracking(true);
      scheduleHover();
    },
    [scheduleHover],
  );

  // 팔레트 rect 를 보드에 올려 보낸다 — 취소 사유 구분(§5)과 온보딩 꼬리 위치.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const publish = () => onRectChange(el.getBoundingClientRect());
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      onRectChange(null);
    };
  }, [onRectChange]);

  // ── 작업 목록 펼침 — 아코디언(한 번에 하나, P1a 트리거) ─────────────
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // 체인 밖 실행 완료를 사용자가 확인했는가 (§6 완료 표시 — "1회").
  const [doneAck, setDoneAck] = useState<ReadonlySet<string>>(new Set());

  const ackDone = useCallback((key: string) => {
    setDoneAck((curr) => (curr.has(key) ? curr : new Set(curr).add(key)));
  }, []);
  const resetDoneAck = useCallback((key: string) => {
    setDoneAck((curr) => {
      if (!curr.has(key)) return curr;
      const next = new Set(curr);
      next.delete(key);
      return next;
    });
  }, []);

  const openWidget = useCallback(
    (key: string) => {
      ackDone(key);
      onOpenWidget(key);
    },
    [ackDone, onOpenWidget],
  );

  // Esc · 바깥 클릭으로 펼침 닫기 (P1b 펼침 닫힘).
  useEffect(() => {
    if (!expandedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedKey(null);
    };
    const onDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setExpandedKey(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [expandedKey]);

  // ── aria-live (§5 키보드 — 단계마다 안내) ──────────────────────────
  const announce = useMemo(() => {
    const d = drag.drag;
    if (!d || d.mode !== 'keyboard') return '';
    const widget = tRoot(`Sidebar.${d.widgetKey}`);
    // 받을 수 있는 자리면 "n단계 자리", 받을 수 없으면 거절 사유를 읽는다
    // (§5 키보드 — "거절 슬롯도 들르되 reject 로 표시하고 사유를 읽음").
    const slot = d.verdict?.ok
      ? tDrag('slotLabel', {
          n: d.over === 'prepend' ? 1 : nextStepNumber,
        })
      : dockReason(d.verdict, d.feature, tChainRaw, tRoot);
    return tDrag('liftedAnnounce', {
      widget,
      // i18n-allow-korean -- josa 쌍 식별자(문법 테이블 키). UI 카피가 아니라 korean-particle.ts 의 JosaPair 리터럴이라 messages/*.json 으로 옮길 수 없다 — ko 문구의 {josa} 자리를 채우는 값이고 en/ja/th 문구에는 그 자리가 없다.
      josa: josa(widget, '을를'),
      slot,
    });
  }, [drag.drag, tRoot, tDrag, tChainRaw, nextStepNumber]);

  return (
    <aside
      ref={rootRef}
      data-palette
      data-palette-collapsed={collapsed ? 'true' : 'false'}
      onPointerMove={onPointerMove}
      style={{
        width: collapsed ? RAIL_W : 'var(--palette-w)',
        padding: collapsed ? '0' : '18px 12px 16px',
      }}
      className={`relative z-fab flex h-full shrink-0 flex-col bg-soft-surface ${
        collapsed ? '' : 'border-r border-soft-hair'
      }`}
    >
      {collapsed ? (
        <PaletteRail
          widgets={widgets}
          view={view}
          dockedSteps={dockedSteps}
          laneCards={laneCards}
          hover={hover}
          onExpand={toggleCollapsed}
          onOpenWidget={openWidget}
          onFocusLaneCard={onFocusLaneCard}
          onFirstInteraction={onFirstInteraction}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
        />
      ) : (
        <>
          {/* 머리 (§4.1) — "위젯 n" + 힌트 + 접기 버튼 28.
              로고 22 타일 + 워드마크 줄은 **2026-10-16 CD 결정(질의 ①
              선택지 A)으로 제거**됐다: 컴프 프레임(1280×800)에 앱 Topbar 가
              없어서 팔레트가 브랜드를 그렸던 것이고, 실제 앱에서는 Topbar 가
              브랜드를 이미 소유해 중복이었다. 팔레트는 "위젯 모듈 서랍"으로
              순수화하고 앱 chrome(브랜드·사용자·크레딧)은 Topbar 단독
              소유다. 되살리지 말 것 — `Brand.name` 키가 남아 있는 건
              Topbar 가 쓰기 때문이다(지우면 Topbar 가 blank).
              접기 버튼은 CD 갱신판이 그리지 않는 요소(컴프엔 접힘 장면이
              별도 프레임)라 §4.1 이 머리에 묶어 둔 대로 "위젯 n" 과 같은
              행에 둔다 — 전용 행을 만들면 컴프에 없는 42px 가 생겨 아래
              타일 전체가 밀린다. */}
          <div
            style={{ gap: 9, padding: '0 6px 8px' }}
            className="flex items-start"
          >
            <div style={{ gap: 2 }} className="flex min-w-0 flex-1 flex-col">
              <span className="text-lg font-bold text-ink">
                {t('heading')}{' '}
                <span className="font-soft-mono text-sm font-medium text-soft-faint">
                  {widgets.length}
                </span>
              </span>
              <span className="text-sm text-soft-faint">{t('hint')}</span>
            </div>
            <CollapseButton collapsed={false} onClick={toggleCollapsed} />
          </div>

          {/* 목록 — gap 4 · 세로 스크롤(§4.1 목록). 사용자 줄이 하단에서
              사라졌으므로 목록이 패널 바닥까지 쓴다(CD 질의 ① A). */}
          <div
            data-palette-list
            style={{ gap: 4 }}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {widgets.map((w) => (
              <PaletteTileRow
                key={w.key}
                widget={w}
                view={view}
                dockedStep={dockedSteps.get(w.key) ?? null}
                laneCards={laneCards}
                feature={stepOfWidget.get(w.key) ?? w.key}
                laneActive={laneActive}
                nextStepNumber={nextStepNumber}
                chainable={isChainable(w.key)}
                hovered={hover?.key === w.key}
                drag={drag}
                expanded={expandedKey === w.key}
                setExpanded={setExpandedKey}
                doneAcked={doneAck.has(w.key)}
                onAckDone={ackDone}
                onResetDoneAck={resetDoneAck}
                onOpenWidget={openWidget}
                onFocusLaneCard={onFocusLaneCard}
                onFirstInteraction={onFirstInteraction}
              />
            ))}
          </div>
        </>
      )}

      {/* 키보드 드래그 안내 — 시각 피드백은 슬롯이 이미 한다(§5 키보드). */}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </aside>
  );
}

function CollapseButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('Canvas.palette');
  return (
    // eslint-disable-next-line react/forbid-elements -- CD 접기/펼치기 버튼은 28(펼침) / 36×28(접힘) 의 chrome 없는 글리프 자리다(§4.1 머리·접힘). IconButton primitive 는 보더/그림자 chrome 을 강제하고 §7.11 로 되돌리기가 불확정 — chain-lane 헤더 액션과 동일 선례.
    <button
      type="button"
      data-palette-collapse-toggle
      onClick={onClick}
      aria-label={collapsed ? t('expand') : t('collapse')}
      style={{ width: collapsed ? 36 : 28, height: 28 }}
      className="ml-auto flex shrink-0 items-center justify-center rounded-nav text-soft-faint focus-visible:outline-none focus-visible:shadow-soft-focus-ring hover:bg-soft-fill"
    >
      <DoubleChevron direction={collapsed ? 'right' : 'left'} />
    </button>
  );
}

/**
 * « / » — CD `canvas-modular-full.dc.html` IP `col` / `exp` 경로 그대로.
 * 듀오톤 세트에 없는 글리프라 세트 규격(viewBox 24 · stroke 1.8 · round
 * cap/join)으로 둔다(§10 "아이콘은 duotone 세트에 없으면 세트 규격으로 추가").
 */
function DoubleChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {direction === 'left' ? (
        <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
      ) : (
        <path d="M13 6l6 6-6 6M5 6l6 6-6 6" />
      )}
    </svg>
  );
}

// ── 타일 한 줄 ────────────────────────────────────────────────────────
// 위젯별 실행 상태(`useWidgetStateOf`)는 **위젯당 하나의 구독**이라 타일마다
// 자기 컴포넌트에서 읽는다(Navigator 의 WidgetStateBadge 와 같은 패턴) —
// 한 위젯이 진척을 push 할 때 팔레트 전체가 다시 그려지지 않는다.

type TileRowProps = {
  widget: WidgetContent;
  view: ChainView | null;
  dockedStep: string | null;
  laneCards: readonly string[];
  feature: string;
  laneActive: boolean;
  nextStepNumber: number;
  chainable: boolean;
  hovered: boolean;
  drag: PaletteDragApi;
  expanded: boolean;
  setExpanded: (key: string | null) => void;
  doneAcked: boolean;
  onAckDone: (key: string) => void;
  onResetDoneAck: (key: string) => void;
  onOpenWidget: (key: string) => void;
  onFocusLaneCard: (key: string) => void;
  onFirstInteraction: () => void;
};

function PaletteTileRow({
  widget,
  view,
  dockedStep,
  laneCards,
  feature,
  laneActive,
  nextStepNumber,
  chainable,
  hovered,
  drag,
  expanded,
  setExpanded,
  doneAcked,
  onAckDone,
  onResetDoneAck,
  onOpenWidget,
  onFocusLaneCard,
  onFirstInteraction,
}: TileRowProps) {
  const t = useTranslations('Canvas.palette');
  const tChain = useTranslations('Chain');
  const tRoot = useTranslations();
  const widgetState = useWidgetStateOf(widget.key);

  const locations = useMemo(
    () => locationsOf({ view, dockedStep, laneCards, widgetState }),
    [view, dockedStep, laneCards, widgetState],
  );

  // 다시 돌기 시작하면 "완료 1회" 확인 기록을 비운다 — 다음 완료도 한 번
  // 보여야 한다(§6 완료 표시). 상태 전이에만 반응한다.
  const kind = widgetState.kind;
  useEffect(() => {
    if (kind === 'running') onResetDoneAck(widget.key);
  }, [kind, widget.key, onResetDoneAck]);

  const inLane = dockedStep !== null;
  const dragging = drag.drag?.widgetKey === widget.key && drag.drag.mode === 'pointer';
  const lifted = drag.drag?.widgetKey === widget.key && drag.drag.mode === 'keyboard';
  const canDrag = isDraggable(inLane);
  // fit — 레인에 빈 슬롯이 있고 가드를 통과할 때. §5 "팔레트에서는 fit 상태를
  // 드래그 시작 전 hover 때 미리 보여줍니다" 라 hover 로 게이트한다.
  const fit =
    hovered &&
    !inLane &&
    laneActive &&
    !drag.drag &&
    drag.canFit(feature);

  const state = tileVisualState({
    dragging,
    lifted,
    fit,
    expanded,
    locations,
    inLane,
  });

  const showDone = !inLane && kind === 'done' && !doneAcked;
  const lead = leadLocation(locations);
  const name = resolveWidgetLabel(tRoot, widget.meta);

  const secondLine: PaletteTileSecondLine = useMemo(() => {
    if (dragging) return { kind: 'note', text: t('dragging') };
    if (lifted) return { kind: 'note', text: t('lifted') };
    if (fit) return { kind: 'fit', text: t('fit', { n: nextStepNumber }) };
    if (locations.length >= 2 && lead) {
      return {
        kind: 'badge',
        tone: toneOf(lead.status),
        text: t('countStatus', {
          n: locations.length,
          status: t(STATUS_KEY[lead.status]),
        }),
        pulse: pulsesFor(lead.status),
      };
    }
    if (lead) {
      const word = t(STATUS_KEY[lead.status]);
      if (lead.kind === 'lane') {
        return {
          kind: 'badge',
          tone: toneOf(lead.status),
          text:
            lead.status === 'pending' && lead.step !== null
              ? t('chainStep', { chain: tChain('lane.title'), n: lead.step })
              : t('chainStatus', { chain: tChain('lane.title'), status: word }),
          pulse: pulsesFor(lead.status),
        };
      }
      return {
        kind: 'badge',
        tone: toneOf(lead.status),
        text: lead.detail ? t('detailed', { status: word, detail: lead.detail }) : word,
        pulse: pulsesFor(lead.status),
      };
    }
    if (showDone) {
      return {
        kind: 'badge',
        tone: 'ok',
        text: t('statusDone'),
        pulse: false,
      };
    }
    return {
      kind: 'meta',
      credits:
        typeof widget.meta.cost === 'number'
          ? t('credits', { n: widget.meta.cost })
          : t('creditsNone'),
      chainChip: chainable ? t('chainChip') : null,
    };
  }, [
    dragging,
    lifted,
    fit,
    locations,
    lead,
    showDone,
    widget.meta.cost,
    chainable,
    nextStepNumber,
    t,
    tChain,
  ]);

  // ── 누르기 (§6 · P5 ②) ─────────────────────────────────────────────
  const goToLocation = useCallback(
    (loc: WidgetLocation) => {
      setExpanded(null);
      if (loc.kind === 'lane') onFocusLaneCard(widget.key);
      else onOpenWidget(widget.key);
    },
    [setExpanded, onFocusLaneCard, onOpenWidget, widget.key],
  );

  const onActivate = useCallback(() => {
    // 드래그로 번진 pointerdown 의 click 은 누르기가 아니다.
    if (drag.consumeDragClick()) return;
    onFirstInteraction();
    onAckDone(widget.key);
    if (locations.length === 0) {
      onOpenWidget(widget.key);
      return;
    }
    if (locations.length === 1) {
      goToLocation(locations[0]);
      return;
    }
    setExpanded(expanded ? null : widget.key);
  }, [
    drag,
    onFirstInteraction,
    onAckDone,
    widget.key,
    locations,
    onOpenWidget,
    goToLocation,
    setExpanded,
    expanded,
  ]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      onFirstInteraction();
      drag.onTilePointerDown(widget.key, feature, canDrag)(e);
    },
    [onFirstInteraction, drag, widget.key, feature, canDrag],
  );

  // ── 키보드 (§5 키보드 · P2f) ────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        if (!canDrag || !laneActive) return;
        e.preventDefault();
        e.stopPropagation();
        onFirstInteraction();
        if (lifted) drag.commitLift();
        else drag.lift(widget.key, feature);
        return;
      }
      if (!lifted) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        drag.commitLift();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        drag.cancelLift();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        drag.moveLift(e.key === 'ArrowRight' ? 1 : -1);
      }
    },
    [canDrag, laneActive, lifted, drag, widget.key, feature, onFirstInteraction],
  );

  const workRows = useMemo(
    () => buildWorkRows(locations, t, tChain, STATUS_KEY),
    [locations, t, tChain],
  );

  return (
    <PaletteTile
      widgetKey={widget.key}
      name={name}
      accent={widget.meta.accent}
      state={state}
      hovered={hovered && !drag.drag}
      pressed={drag.pressedKey === widget.key}
      secondLine={secondLine}
      count={locations.length >= 2 ? locations.length : null}
      canDrag={canDrag}
      onPointerDown={onPointerDown}
      onActivate={onActivate}
      onKeyDown={onKeyDown}
      onCountChipClick={() => setExpanded(expanded ? null : widget.key)}
      ariaLabel={name}
      ariaExpanded={locations.length >= 2 ? expanded : undefined}
      workList={
        <PaletteWorkList
          rows={workRows.rows}
          selectedId={null}
          moreLabel={
            workRows.more > 0 ? t('workListMore', { n: workRows.more }) : null
          }
          libraryLabel={t('workListLibrary')}
          onSelect={goToLocation}
        />
      }
    />
  );
}

// ── 접힘 레일 (§4.1) ─────────────────────────────────────────────────

function PaletteRail({
  widgets,
  view,
  dockedSteps,
  laneCards,
  hover,
  onExpand,
  onOpenWidget,
  onFocusLaneCard,
  onFirstInteraction,
  expandedKey,
  setExpandedKey,
}: {
  widgets: WidgetContent[];
  view: ChainView | null;
  dockedSteps: Map<string, string>;
  laneCards: readonly string[];
  hover: Hover;
  onExpand: () => void;
  onOpenWidget: (key: string) => void;
  onFocusLaneCard: (key: string) => void;
  onFirstInteraction: () => void;
  expandedKey: string | null;
  setExpandedKey: (key: string | null) => void;
}) {
  return (
    <div
      data-palette-rail
      style={{ width: RAIL_W, gap: 8, padding: '12px 0' }}
      className="flex h-full flex-col items-center overflow-y-auto rounded-sm border border-soft-line bg-soft-surface"
    >
      <CollapseButton collapsed onClick={onExpand} />
      {widgets.map((w) => (
        <PaletteRailTile
          key={w.key}
          widget={w}
          view={view}
          dockedStep={dockedSteps.get(w.key) ?? null}
          laneCards={laneCards}
          hovered={hover?.key === w.key}
          hoverRect={hover?.key === w.key ? hover.rect : null}
          expanded={expandedKey === w.key}
          setExpanded={setExpandedKey}
          onOpenWidget={onOpenWidget}
          onFocusLaneCard={onFocusLaneCard}
          onFirstInteraction={onFirstInteraction}
        />
      ))}
    </div>
  );
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

function PaletteRailTile({
  widget,
  view,
  dockedStep,
  laneCards,
  hovered,
  hoverRect,
  expanded,
  setExpanded,
  onOpenWidget,
  onFocusLaneCard,
  onFirstInteraction,
}: {
  widget: WidgetContent;
  view: ChainView | null;
  dockedStep: string | null;
  laneCards: readonly string[];
  hovered: boolean;
  hoverRect: DOMRect | null;
  expanded: boolean;
  setExpanded: (key: string | null) => void;
  onOpenWidget: (key: string) => void;
  onFocusLaneCard: (key: string) => void;
  onFirstInteraction: () => void;
}) {
  const t = useTranslations('Canvas.palette');
  const tChain = useTranslations('Chain');
  const tRoot = useTranslations();
  const widgetState = useWidgetStateOf(widget.key);
  const locations = useMemo(
    () => locationsOf({ view, dockedStep, laneCards, widgetState }),
    [view, dockedStep, laneCards, widgetState],
  );
  const lead = leadLocation(locations);
  const name = resolveWidgetLabel(tRoot, widget.meta);
  const detail = lead
    ? locations.length >= 2
      ? t('countStatus', {
          n: locations.length,
          status: t(STATUS_KEY[lead.status]),
        })
      : lead.kind === 'lane'
        ? t('chainStatus', {
            chain: tChain('lane.title'),
            status: t(STATUS_KEY[lead.status]),
          })
        : t(STATUS_KEY[lead.status])
    : null;

  const workRows = useMemo(
    () => buildWorkRows(locations, t, tChain, STATUS_KEY),
    [locations, t, tChain],
  );

  // 팝오버 앵커는 **누른 순간의 rect** 다 — hover rect 로 고정하면 포인터가
  // 레일을 벗어나는 순간 앵커가 사라져 팝오버가 (0,0)으로 튄다.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const onClick = () => {
    onFirstInteraction();
    if (locations.length === 0) {
      onOpenWidget(widget.key);
      return;
    }
    if (locations.length === 1) {
      setExpanded(null);
      if (locations[0].kind === 'lane') onFocusLaneCard(widget.key);
      else onOpenWidget(widget.key);
      return;
    }
    setAnchor(btnRef.current?.getBoundingClientRect() ?? null);
    setExpanded(expanded ? null : widget.key);
  };

  return (
    <>
      {/* eslint-disable-next-line react/forbid-elements -- 접힘 레일 타일은 44 정사각 톤 타일 + 상태 점 11(흰 2px 테두리) 전용 chrome 이다(§4.1 접힘). IconButton primitive 는 자기 보더/그림자를 그려 톤 타일 읽기를 깨뜨린다 — 펼친 타일과 같은 선례. */}
      <button
        ref={btnRef}
        type="button"
        data-palette-tile={widget.key}
        data-palette-rail-tile={widget.key}
        onClick={onClick}
        aria-label={name}
        style={{ width: 44, height: 44 }}
        className={`palette-tile-handle relative flex shrink-0 items-center justify-center rounded-card focus-visible:outline-none ${ACCENT_BG[widget.meta.accent]}`}
      >
        <DuotoneIcon
          name={widgetIconFor(widget.key)}
          size={22}
          fill="var(--color-paper)"
        />
        {lead && (
          <span
            aria-hidden
            style={{ right: -3, top: -3, width: 11, height: 11 }}
            className={`absolute rounded-full border border-soft-surface ${
              RAIL_DOT[toneOf(lead.status)]
            } ${pulsesFor(lead.status) ? 'palette-pulse' : ''}`}
          />
        )}
      </button>
      {hovered && hoverRect && !expanded && (
        <PaletteRailTooltip
          x={hoverRect.right + 10}
          y={hoverRect.top}
          name={name}
          detail={detail}
        />
      )}
      {expanded && anchor && (
        <PaletteRailPopover x={anchor.right + 10} y={anchor.top}>
          <PaletteWorkList
            rows={workRows.rows}
            selectedId={null}
            moreLabel={
              workRows.more > 0 ? t('workListMore', { n: workRows.more }) : null
            }
            libraryLabel={t('workListLibrary')}
            onSelect={(loc) => {
              setExpanded(null);
              if (loc.kind === 'lane') onFocusLaneCard(widget.key);
              else onOpenWidget(widget.key);
            }}
          />
        </PaletteRailPopover>
      )}
    </>
  );
}

// ── 공유 파생 ─────────────────────────────────────────────────────────

/** §4.3 — 최대 5행, 넘치면 "외 n건". 완료된 실행은 애초에 위치가 아니다. */
function buildWorkRows(
  locations: readonly WidgetLocation[],
  t: Translator,
  tChain: Translator,
  statusKey: Record<LocationStatus, string>,
): { rows: WorkListRow[]; more: number } {
  const shown = locations.slice(0, WORK_LIST_MAX_ROWS);
  return {
    rows: shown.map((location) => {
      const word = t(statusKey[location.status]);
      return {
        location,
        title:
          location.kind === 'lane'
            ? t('chainStep', {
                chain: tChain('lane.title'),
                n: location.step ?? 1,
              })
            : t('rowFullview'),
        status: location.detail
          ? t('detailed', { status: word, detail: location.detail })
          : word,
      };
    }),
    more: Math.max(0, locations.length - shown.length),
  };
}
