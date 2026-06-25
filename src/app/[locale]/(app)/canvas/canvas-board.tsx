'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasBoard — production /canvas. n8n 스타일 워크플로우 캔버스.

   PR-D1-canvas 재작업 (이전 6×5 grid snap 대시보드 → free positioning
   node graph). 핵심 변경:
   - 자유 좌표 (x, y) — 8px sub-snap. grid 강제 없음.
   - 점 grid 배경 (n8n 시그너처) — 항상 보임, 옅음.
   - 위젯 간 SVG bezier connection edge (translate↔probing live, 그 외 flow).
   - 위젯 collapse 토글 (헤더만 표시) — 그래프 구조 한눈에.
   - 우상단 미니맵 + 하단 floating 툴바 (zoom/fit/reset).
   - select 상태 (헤더 클릭) → outline.

   pan: space hold + drag (Figma/Miro/n8n 표준). zoom: wheel.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { WidgetShell } from '@/components/canvas/shell/widget-shell';
import { CanvasEdges } from '@/components/canvas/canvas-edges';
import { CanvasToolbar } from '@/components/canvas/canvas-toolbar';
import { CanvasMinimap } from '@/components/canvas/canvas-minimap';
import { CanvasThemeSwitcher } from '@/components/canvas/canvas-theme-switcher';
import type { WidgetContent } from '@/components/canvas/widget-types';
import {
  asFontKey,
  getThemeMeta,
  resolveFont,
  type CanvasTheme,
  type WidgetLayout,
  type WidgetPanel,
  type WidgetInterior,
} from '@/lib/canvas/themes';
import {
  CANVAS_W,
  CANVAS_H,
  DEFAULT_NODE_POSITIONS,
  NODE_COLLAPSED_H,
  NODE_DEFAULT_H,
  NODE_DEFAULT_W,
  snapToGrid,
  type NodePosition,
} from '@/lib/canvas/graph';
import type { CanvasWidgetKey } from '@/lib/canvas/visibility';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_FACTOR = 1.08;
const STORAGE_KEY = 'canvas:graph:v2';
const TRANSPARENT_GHOST_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

type WidgetState = {
  pos: NodePosition;
  collapsed: boolean;
};
type GraphState = Record<string, WidgetState>;

function defaultStateFor(widgets: WidgetContent[]): GraphState {
  const out: GraphState = {};
  // 기본 컬럼 layout 에 없는 widget 은 fallback 으로 우측 끝에 row 추가.
  let fallbackY = 160;
  widgets.forEach((w) => {
    const defaultPos = DEFAULT_NODE_POSITIONS[w.key as CanvasWidgetKey];
    if (defaultPos) {
      out[w.key] = { pos: { ...defaultPos }, collapsed: false };
    } else {
      out[w.key] = {
        pos: { x: 3 * NODE_DEFAULT_W + 800, y: fallbackY },
        collapsed: false,
      };
      fallbackY += NODE_DEFAULT_H + 160;
    }
  });
  return out;
}

function heightOf(s: WidgetState): number {
  return s.collapsed ? NODE_COLLAPSED_H : NODE_DEFAULT_H;
}

export function CanvasBoard({
  widgets,
  initialTheme = 'default',
  initialFontKey,
  initialLayout = 'classic',
  initialPanel = 'plain',
  initialInterior = 'default',
}: {
  widgets: WidgetContent[];
  initialFocus?: string;
  initialTheme?: CanvasTheme;
  initialFontKey?: string;
  initialLayout?: WidgetLayout;
  initialPanel?: WidgetPanel;
  initialInterior?: WidgetInterior;
}) {
  const [graph, setGraph] = useState<GraphState>(() => defaultStateFor(widgets));
  const [selected, setSelected] = useState<string | null>(null);
  const [theme, setThemeRaw] = useState<CanvasTheme>(initialTheme);
  const [fontKey, setFontKey] = useState<string>(
    () => asFontKey(initialTheme, initialFontKey),
  );
  const [layout, setLayout] = useState<WidgetLayout>(initialLayout);
  const [panel, setPanel] = useState<WidgetPanel>(initialPanel);
  const [interior, setInterior] = useState<WidgetInterior>(initialInterior);

  // theme 변경 시 font 도 그 theme 의 default(첫번째) 로 reset.
  // 사용자가 명시적으로 같은 theme 안에서 font 만 바꿀 땐 setFontKey 직접 호출.
  const setTheme = useCallback((next: CanvasTheme) => {
    setThemeRaw(next);
    setFontKey(getThemeMeta(next).fonts[0].key);
  }, []);

  const activeFont = useMemo(() => resolveFont(theme, fontKey), [theme, fontKey]);

  // hydrate from localStorage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as GraphState;
      if (typeof stored !== 'object' || stored === null) return;
      const next: GraphState = {};
      widgets.forEach((w) => {
        const s = stored[w.key];
        const base = DEFAULT_NODE_POSITIONS[w.key as CanvasWidgetKey] ?? { x: 200, y: 200 };
        if (
          s &&
          typeof s.pos?.x === 'number' &&
          typeof s.pos?.y === 'number'
        ) {
          next[w.key] = {
            pos: {
              x: clamp(s.pos.x, 0, CANVAS_W - NODE_DEFAULT_W),
              y: clamp(s.pos.y, 0, CANVAS_H - NODE_COLLAPSED_H),
            },
            collapsed: !!s.collapsed,
          };
        } else {
          next[w.key] = { pos: { ...base }, collapsed: false };
        }
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage on mount
      setGraph(next);
    } catch {
      /* ignore */
    }
  }, [widgets]);

  const persist = useCallback((next: GraphState) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }, []);

  const widgetByKey = useMemo(
    () => Object.fromEntries(widgets.map((w) => [w.key, w])),
    [widgets],
  );

  // 각 위젯의 box (edges / minimap / fit-to-screen 모두 공용).
  const boxes = useMemo(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    widgets.forEach((w) => {
      const s = graph[w.key];
      if (!s) return;
      out[w.key] = {
        x: s.pos.x,
        y: s.pos.y,
        w: NODE_DEFAULT_W,
        h: heightOf(s),
      };
    });
    return out;
  }, [graph, widgets]);

  const visibleKeys = useMemo(
    () => new Set(widgets.map((w) => w.key as CanvasWidgetKey)),
    [widgets],
  );

  // ── pan / zoom ─────────────────────────────────────────────────────
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.6);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // 컨테이너 사이즈 측정 (viewport / fit-to-screen 용)
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // space hold = pan 모드
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
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

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === zoom) return;
      const rect = container.getBoundingClientRect();
      // cursor 를 zoom focal point 로 — 화면 좌표 → surface 로컬 보정
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ratio = nextZoom / zoom;
      setPan({
        x: cx - (cx - pan.x) * ratio,
        y: cy - (cy - pan.y) * ratio,
      });
      setZoom(nextZoom);
    },
    [zoom, pan],
  );

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isSpaceHeld) {
        // 빈 영역 클릭 = 선택 해제
        if (e.target === e.currentTarget) setSelected(null);
        return;
      }
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

  const onMouseUp = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

  // pan cursor 강제 (전역 <style> 한 번만, flicker 방지)
  useEffect(() => {
    if (!isPanning && !isSpaceHeld) return;
    const cursor = isPanning ? 'grabbing' : 'grab';
    const prev = document.body.style.cursor;
    document.body.style.cursor = cursor;
    const styleEl = document.createElement('style');
    styleEl.dataset.canvasPanCursor = '';
    styleEl.textContent = `*, *::before, *::after { cursor: ${cursor} !important; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.body.style.cursor = prev;
      styleEl.remove();
    };
  }, [isPanning, isSpaceHeld]);

  // ── widget drag (헤더 → 자유 이동) ─────────────────────────────────
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);
  const ghostRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.src = TRANSPARENT_GHOST_SRC;
    ghostRef.current = img;
  }, []);

  const onHandleDragStart = useCallback(
    (key: string) =>
      (e: ReactDragEvent<HTMLElement>) => {
        e.stopPropagation();
        if (ghostRef.current) {
          try {
            e.dataTransfer.setDragImage(ghostRef.current, 0, 0);
          } catch {
            /* Firefox 일부 */
          }
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
        // drag 시작 시 위젯 box top-left 와 cursor 의 offset 기록 — drop 위치
        // 계산에 사용. e.clientX/Y 는 화면 좌표, pos 는 surface 좌표.
        const card = (e.currentTarget as HTMLElement).closest('[data-canvas-card]');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        dragRef.current = {
          key,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
        };
      },
    [],
  );

  const onSurfaceDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onSurfaceDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const { key, offsetX, offsetY } = dragRef.current;
      dragRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // 화면 좌표 → surface 좌표: (clientX - rect.left - pan.x) / zoom
      const screenX = e.clientX - rect.left - pan.x;
      const screenY = e.clientY - rect.top - pan.y;
      const surfaceX = (screenX - offsetX * zoom) / zoom;
      const surfaceY = (screenY - offsetY * zoom) / zoom;
      const w = widgetByKey[key];
      if (!w) return;
      setGraph((curr) => {
        const s = curr[key];
        if (!s) return curr;
        const next = {
          ...curr,
          [key]: {
            ...s,
            pos: {
              x: snapToGrid(clamp(surfaceX, 0, CANVAS_W - NODE_DEFAULT_W)),
              y: snapToGrid(clamp(surfaceY, 0, CANVAS_H - heightOf(s))),
            },
          },
        };
        persist(next);
        return next;
      });
    },
    [pan, zoom, persist, widgetByKey],
  );

  const onHandleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── widget collapse / select ───────────────────────────────────────
  const toggleCollapse = useCallback(
    (key: string) => {
      setGraph((curr) => {
        const s = curr[key];
        if (!s) return curr;
        const next = { ...curr, [key]: { ...s, collapsed: !s.collapsed } };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // ── toolbar actions ────────────────────────────────────────────────
  const zoomIn = useCallback(() => setZoom((z) => clamp(z * ZOOM_FACTOR, MIN_ZOOM, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp(z / ZOOM_FACTOR, MIN_ZOOM, MAX_ZOOM)), []);
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);
  const fitToScreen = useCallback(() => {
    if (!containerSize.w || !containerSize.h) return;
    const all = Object.values(boxes);
    if (all.length === 0) return;
    const minX = Math.min(...all.map((b) => b.x));
    const minY = Math.min(...all.map((b) => b.y));
    const maxX = Math.max(...all.map((b) => b.x + b.w));
    const maxY = Math.max(...all.map((b) => b.y + b.h));
    const padding = 120;
    const bbW = maxX - minX + padding * 2;
    const bbH = maxY - minY + padding * 2;
    const nextZoom = clamp(
      Math.min(containerSize.w / bbW, containerSize.h / bbH),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    // center bbox in viewport: pan.x = containerCenter - bbCenter * zoom
    const bbCx = (minX + maxX) / 2;
    const bbCy = (minY + maxY) / 2;
    setZoom(nextZoom);
    setPan({
      x: containerSize.w / 2 - bbCx * nextZoom,
      y: containerSize.h / 2 - bbCy * nextZoom,
    });
  }, [containerSize, boxes]);
  const resetLayout = useCallback(() => {
    const fresh = defaultStateFor(widgets);
    setGraph(fresh);
    persist(fresh);
  }, [widgets, persist]);

  // 초기 마운트 후 fit-to-screen 1 회 (container 측정 완료 후).
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (!containerSize.w || !containerSize.h) return;
    didInitialFitRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fit after container measure
    fitToScreen();
  }, [containerSize, fitToScreen]);

  // ── minimap viewport rect (surface 좌표계) ────────────────────────
  const viewport = useMemo(
    () => ({
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      w: containerSize.w / zoom,
      h: containerSize.h / zoom,
    }),
    [pan, zoom, containerSize],
  );

  const jumpTo = useCallback(
    (sx: number, sy: number) => {
      if (!containerSize.w || !containerSize.h) return;
      setPan({
        x: containerSize.w / 2 - sx * zoom,
        y: containerSize.h / 2 - sy * zoom,
      });
    },
    [containerSize, zoom],
  );

  return (
    <div
      ref={containerRef}
      data-canvas-theme={theme}
      data-canvas-interior={interior}
      className="relative h-[calc(100vh-3rem)] overflow-hidden"
      style={{
        background: 'var(--canvas-bg)',
        // 활성 font 를 헤더 폰트 variable 에 주입 — 자식 WidgetShell /
        // Toolbar / Switcher 가 모두 var(--canvas-card-header-font) 사용.
        ['--canvas-card-header-font' as never]: activeFont.family,
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDragOver={onSurfaceDragOver}
      onDrop={onSurfaceDrop}
    >
      {/* surface — pan + zoom 적용. dot grid 는 theme 의 --canvas-bg-image
          + --canvas-bg-size 로 결정 (theme 마다 dot 크기/색/유무 다름). */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transition: isPanning ? 'none' : 'transform 0.2s ease-out',
          backgroundImage: 'var(--canvas-bg-image)',
          backgroundSize: 'var(--canvas-bg-size)',
          backgroundPosition: '0 0',
        }}
      >
        {/* connection edges (위젯 아래 layer) */}
        <CanvasEdges
          boxes={boxes}
          surfaceW={CANVAS_W}
          surfaceH={CANVAS_H}
          visibleKeys={visibleKeys}
        />
        {/* widgets */}
        {widgets.map((w, idx) => {
          const s = graph[w.key];
          if (!s) return null;
          const h = heightOf(s);
          return (
            <div
              key={w.key}
              data-canvas-card
              data-widget-key={w.key}
              className="absolute"
              style={{
                left: s.pos.x,
                top: s.pos.y,
                width: NODE_DEFAULT_W,
                height: h,
                transition: 'height 0.18s ease-out',
              }}
            >
              <WidgetShell
                content={w}
                dashboardMode
                theme={theme}
                layout={layout}
                panel={panel}
                index={idx + 1}
                isCollapsed={s.collapsed}
                isSelected={selected === w.key}
                onSelect={() => setSelected(w.key)}
                onToggleCollapse={() => toggleCollapse(w.key)}
                dragHandleProps={{
                  draggable: true,
                  onDragStart: onHandleDragStart(w.key),
                  onDragEnd: onHandleDragEnd,
                  onMouseDown: (e) => e.stopPropagation(),
                }}
              />
            </div>
          );
        })}
      </div>

      {/* edge live + cyber LED 애니메이션 — global keyframe (한 번만 inject). */}
      <style jsx global>{`
        @keyframes canvasEdgeFlow {
          to {
            stroke-dashoffset: -24;
          }
        }
        .canvas-edge-live {
          animation: canvasEdgeFlow 1.4s linear infinite;
        }
        @keyframes cyberLedPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(1.2); }
        }
      `}</style>

      <CanvasThemeSwitcher
        theme={theme}
        fontKey={fontKey}
        layout={layout}
        panel={panel}
        interior={interior}
        onChangeTheme={setTheme}
        onChangeFont={setFontKey}
        onChangeLayout={setLayout}
        onChangePanel={setPanel}
        onChangeInterior={setInterior}
      />

      <CanvasMinimap
        boxes={boxes}
        surfaceW={CANVAS_W}
        surfaceH={CANVAS_H}
        viewport={viewport}
        onJumpTo={jumpTo}
      />

      <CanvasToolbar
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitToScreen={fitToScreen}
        onResetZoom={resetZoom}
        onResetLayout={resetLayout}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
