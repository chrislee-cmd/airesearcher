'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainOverlay — v2 커넥터 오버레이의 배치 호스트.

   CD SSOT: `design-handoff/widget-chain/v2/README.md`.

   하는 일: 카드 rect 측정 → 엣지 경로 계산 → 엣지·포트·캡슐·라벨·마크·산출물
   노드 배치. 데이터(조회·realtime·액션)는 전부 `widget-chain-provider` 가 이미
   소유하므로 여기선 읽어 쓰기만 한다.

   **카드와 같은 transform 레이어 안**에 마운트된다(README Interactions) — 캔버스를
   pan/zoom 해도 엣지가 카드에 붙어 따라간다. 좌표는 전부 surface 좌표계이고,
   카드 이동·리사이즈는 ResizeObserver + rAF 로 다시 측정한다.

   레이어 순서(README §Geometry: 카드 2 · 엣지 3 · 포트 4 · 라벨/마크 5 · 캡슐 6 ·
   진입 팝오버 8)는 **DOM 순서**로 표현한다. 이 숫자들은 앱 전역 z 티어가 아니라
   오버레이 안의 지역 순서라, `z-[N]` 하드코드(DS 가드가 차단) 대신 렌더 순서로
   같은 결과를 낸다 — 산출물 노드만 카드 층(2)이라 가장 먼저 그린다.

   단, **조작 가능한 층(포트·라벨·캡슐·팝오버)은 `z-overlay`** 를 쓴다. 캔버스는
   줌이 FOCUS_THRESHOLD 아래면 카드마다 click-to-focus 오버레이(z-overlay)를
   깔아 포인터를 가로채는데, 체인의 결정 표면이 거기 묻히면 **줌아웃 상태에서
   승인을 누를 수 없다**(프리뷰 실측). 체인 오버레이는 카드보다 뒤에 그려지므로
   같은 z 에서 DOM 순서로 이긴다 — 새 z 티어를 만들지 않고 해소된다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePaywall } from '@/components/paywall-provider';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import {
  CHAIN_STEP_WIDGET_KEY,
  capsuleEdgeIndex,
  chainPreviewRows,
  deriveEdgeKinds,
  doneCount,
  lastDoneStep,
  lastEdgeTargetsReport,
  runningEdgeIndex,
  type ChainEdgeKind,
  type ChainStepFeature,
  type ChainView,
} from '@/lib/chains/view';
import {
  outPortX,
  inPortX,
  routeEdge,
  PORT_INSET,
  PORT_R,
  type Box,
} from './chain-geometry';
import { ChainEdgeLayer, type ChainEdgeRender } from './chain-edge-layer';
import { ChainPort } from './chain-port';
import { ChainCapsule, type ChainCapsuleProps } from './chain-capsule';
import {
  ChainReportNode,
  REPORT_NODE_WIDTH,
  REPORT_NODE_HEIGHT,
} from './chain-report-node';
import { ChainEntryPopover } from './chain-entry-popover';
import { useWidgetChain } from './widget-chain-provider';

/** 체인을 만들 수 있는 위젯(파일럿 = 프로빙만 — WRITER-ANSWERS-V2). */
const ENTRY_WIDGET_KEY = 'probing';
const TEMPLATE = 'interview_pipeline';
/** 산출물 노드는 마지막 카드 오른쪽 64px (CD S6). */
const REPORT_GAP = 64;

const TONE_BG: Record<ChainStepFeature, string> = {
  probing: 'bg-sky',
  transcripts: 'bg-lav',
  interview_ingest: 'bg-rose',
  topline: 'bg-rose',
};

type FocusHandlers = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

type PortSpec = {
  x: number;
  cardTop: number;
  role: 'out' | 'in';
  /** 이 포트가 속한 엣지 index — cancelled 에서 dim 판정에 쓴다. */
  edge: number;
  toneClass?: string;
};

type RouteSet = {
  routes: ReturnType<typeof routeEdge>[];
  ports: PortSpec[];
  reportBox: Box | null;
};

export type ChainOverlayProps = {
  /** 카드 transform 레이어(= data-canvas-surface) 엘리먼트. */
  surfaceEl: HTMLElement | null;
  /** 레이아웃 변화 키(카드 배치 직렬화) — 바뀌면 재측정. */
  layoutKey: string;
  /** 위젯 전체보기 열기 (S5/S6 CTA). */
  onOpenWidget: (widgetKey: string) => void;
  /** 체인 포커스 — 비체인 카드 dim 은 board 가 적용한다(S3b). */
  onFocusChange: (focused: boolean) => void;
};

export function ChainOverlay({
  surfaceEl,
  layoutKey,
  onOpenWidget,
  onFocusChange,
}: ChainOverlayProps) {
  const t = useTranslations('Chain');
  const { view, busy, approve, skip, cancel, resume, dismiss, createChain } =
    useWidgetChain();
  const { showPaywall } = usePaywall();
  const { projects, create } = useInterviewV2Projects();

  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [surfaceSize, setSurfaceSize] = useState({ w: 0, h: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<'approve' | 'auto'>('approve');
  // 진입 핸들 노출 — 포인터가 "카드 ∪ 핸들" 영역 안에 있는가(기하 판정).
  const [pointerNear, setPointerNear] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── 측정 ──────────────────────────────────────────────────────────
  const measure = useCallback(() => {
    if (!surfaceEl) return;
    const surfaceRect = surfaceEl.getBoundingClientRect();
    // transform scale 제거 → surface 좌표계(offsetWidth 는 미변환 레이아웃 폭).
    const zoom = surfaceRect.width / (surfaceEl.offsetWidth || 1) || 1;
    const next: Record<string, Box> = {};
    surfaceEl.querySelectorAll<HTMLElement>('[data-widget-key]').forEach((w) => {
      const key = w.getAttribute('data-widget-key');
      if (!key) return;
      // 포트는 셀 래퍼가 아니라 **카드 프레임**(604×900) 기준이다.
      const frame =
        w.querySelector<HTMLElement>(':scope > div > [aria-expanded]') ?? w;
      const r = frame.getBoundingClientRect();
      next[key] = {
        left: (r.left - surfaceRect.left) / zoom,
        top: (r.top - surfaceRect.top) / zoom,
        width: r.width / zoom,
        height: r.height / zoom,
      };
    });
    setBoxes(next);
    setSurfaceSize({ w: surfaceEl.offsetWidth, h: surfaceEl.offsetHeight });
  }, [surfaceEl]);

  useEffect(() => {
    if (!surfaceEl) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(surfaceEl);
    surfaceEl
      .querySelectorAll<HTMLElement>('[data-widget-key]')
      .forEach((w) => ro.observe(w));
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [surfaceEl, measure, layoutKey]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 진입 핸들 노출(S0) — **기하 판정**으로 결정한다.
  //
  // ⚠️ mouseenter/mouseleave 로는 이 문제가 풀리지 않는다. 핸들은 카드의 자식이
  // 아니라 포트 레이어(surface 직계)에 그려지고, 중심이 카드 상단 테두리 위라
  // 위쪽 절반은 카드 bounding box 밖이다. 두 이벤트는 기하가 아니라 **DOM 포함
  // 관계**로 판정하므로 포인터가 핸들에 닿는 순간 카드의 mouseleave 가 터지고,
  // 카드 hover 로만 노출을 걸면 핸들이 사라졌다 나타나는 루프가 돈다. 카드/핸들
  // hover 를 따로 세고 숨김 디바운스를 거는 방식도 **이벤트 순서에 의존**해
  // 불안정했다(프리뷰 실측: leave 가 이기면 160ms 뒤 숨김 → 포인터 밑이 다시
  // 카드 → 재노출 → … 초당 수 회 깜빡임). 포인터 좌표 하나로 판정하면 DOM 포함
  // 관계도, 이벤트 순서도, 타이머도 개입하지 않는다.
  useEffect(() => {
    if (view || !surfaceEl) {
      setPointerNear(false);
      return;
    }
    let raf = 0;
    let last: { x: number; y: number } | null = null;
    const evaluate = () => {
      raf = 0;
      const p = last;
      if (!p) return;
      const card = surfaceEl.querySelector<HTMLElement>(
        `[data-widget-key="${ENTRY_WIDGET_KEY}"]`,
      );
      const frame =
        card?.querySelector<HTMLElement>(':scope > div > [aria-expanded]') ??
        card;
      if (!frame) {
        setPointerNear(false);
        return;
      }
      const r = frame.getBoundingClientRect();
      // 캔버스 줌만큼 히트 영역도 같이 줄어든다.
      const scale = r.width / (frame.offsetWidth || r.width) || 1;
      const inCard =
        p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      // 카드 밖으로 비져 나온 핸들 위쪽 절반 + 여유.
      const hx = r.right - PORT_INSET * scale;
      const pad = (PORT_R + 8) * scale;
      const nearHandle =
        p.x >= hx - pad && p.x <= hx + pad && p.y >= r.top - pad && p.y <= r.top;
      setPointerNear(inCard || nearHandle);
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      // rAF 스로틀 — pointermove 마다 레이아웃을 읽지 않는다.
      if (!raf) raf = requestAnimationFrame(evaluate);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [view, surfaceEl, layoutKey]);

  const allBoxes = useMemo(() => Object.values(boxes), [boxes]);
  const preview = useMemo(() => chainPreviewRows(TEMPLATE, 0), []);
  const entryBox = boxes[ENTRY_WIDGET_KEY] ?? null;

  // ── S0 고스트 미리보기 (체인 없음 + 팝오버 열림) ──────────────────
  const ghost = useMemo(() => {
    if (view || !entryOpen || !entryBox) return null;
    return buildRoutes(
      preview.map((p) => p.feature),
      boxes,
      allBoxes,
      true,
    );
  }, [view, entryOpen, entryBox, preview, boxes, allBoxes]);

  // ── 체인 활성 ─────────────────────────────────────────────────────
  const chain = useMemo(() => {
    if (!view || view.steps.length < 2) return null;
    const set = buildRoutes(
      view.steps.map((s) => s.feature),
      boxes,
      allBoxes,
      lastEdgeTargetsReport(view),
    );
    if (!set) return null;
    return { ...set, kinds: deriveEdgeKinds(view) };
  }, [view, boxes, allBoxes]);

  const edges: ChainEdgeRender[] = useMemo(() => {
    if (ghost) {
      return ghost.routes.map((route) => ({
        kind: 'ghost' as ChainEdgeKind,
        route,
      }));
    }
    if (!chain) return [];
    return chain.routes.map((route, i) => ({
      kind: chain.kinds[i] ?? ('pending' as ChainEdgeKind),
      route,
    }));
  }, [ghost, chain]);

  const focusHandlers: FocusHandlers = useMemo(
    () => ({
      onMouseEnter: () => onFocusChange(true),
      onMouseLeave: () => onFocusChange(false),
      onFocus: () => onFocusChange(true),
      onBlur: () => onFocusChange(false),
    }),
    [onFocusChange],
  );

  if (!surfaceEl) return null;

  const showEntryHandle =
    !view && !!entryBox && (pointerNear || handleFocused || entryOpen);

  return (
    <>
      {/* 산출물 노드 — 카드와 같은 층(2). 엣지보다 먼저 그려 엣지가 위로 간다. */}
      {!ghost && chain?.reportBox && view && (
        <ChainReportNode
          state={
            view.steps[view.steps.length - 1]?.status === 'done'
              ? 'done'
              : 'pending'
          }
          left={chain.reportBox.left}
          top={chain.reportBox.top}
        />
      )}

      {edges.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          <ChainEdgeLayer
            edges={edges}
            width={surfaceSize.w}
            height={surfaceSize.h}
            reducedMotion={reducedMotion}
          />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-overlay">
        {!view && entryBox && (
          // 핸들은 **상시 mount** 하고 투명도로만 숨긴다(ChainPort.hidden 주석).
          // 핸들 자신의 hover/focus 도 노출 조건에 넣는다 — 포인터가 카드를 떠나
          // 핸들로 올라와도 사라지지 않아야 클릭이 성립한다. 숨김 상태에서는
          // pointer-events 를 끊어 "안 보이는데 눌리는" 상태를 막되, Tab 포커스는
          // 살려 둔다(focus 가 곧 노출 조건).
          <span
            className={
              showEntryHandle ? 'pointer-events-auto' : 'pointer-events-none'
            }
            // hover 는 위 기하 판정이 담당한다. 여기선 키보드 포커스만 — Tab 으로
            // 닿으면 노출돼야 하므로(CD 키보드 요구) 노출 조건에 포함한다.
            onFocus={() => setHandleFocused(true)}
            onBlur={() => setHandleFocused(false)}
          >
            <ChainPort
              kind="handle"
              x={outPortX(entryBox)}
              cardTop={entryBox.top}
              label={t('entry.handleLabel')}
              hidden={!showEntryHandle}
              onClick={() => setEntryOpen((v) => !v)}
            />
          </span>
        )}
        {ghost?.ports.map((p, i) => (
          <ChainPort
            key={`g${i}`}
            kind={p.role === 'out' ? 'dim' : 'target'}
            x={p.x}
            cardTop={p.cardTop}
          />
        ))}
        {!ghost &&
          chain?.ports.map((p, i) => (
            <ChainPort
              key={`p${i}`}
              // S7: 가지 못한 구간의 포트는 dim 으로 (끝까지 간 엣지만 유지).
              kind={
                view?.status === 'cancelled' && chain.kinds[p.edge] !== 'done'
                  ? 'dim'
                  : p.role
              }
              x={p.x}
              cardTop={p.cardTop}
              toneClass={p.toneClass}
            />
          ))}
      </div>

      {!ghost && chain && view && (
        <ChainMarkers view={view} chain={chain} focusHandlers={focusHandlers} />
      )}

      {!ghost && chain && view && (
        <ChainCapsuleSlot
          view={view}
          chain={chain}
          busy={busy}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          focusHandlers={focusHandlers}
          pickedProject={pickedProject}
          onPickProject={setPickedProject}
          onCreateProject={() => setCreateOpen(true)}
          onApprove={() => {
            void approve(view.currentStep, pickedProject);
            setPickedProject(null);
          }}
          onSkip={() => void skip(view.currentStep)}
          onCancel={() => void cancel()}
          onResume={() => void resume()}
          onTopUp={showPaywall}
          onDismiss={dismiss}
          onOpenWidget={onOpenWidget}
        />
      )}

      {entryOpen && entryBox && !view && (
        <div className="absolute inset-0 z-overlay">
          <ChainEntryPopover
            mode={entryMode}
            onModeChange={setEntryMode}
            preview={preview.filter((p) => !p.entryStep)}
            busy={busy}
            left={outPortX(entryBox) + 24}
            top={entryBox.top - 16}
            onCancel={() => setEntryOpen(false)}
            onConnect={() => {
              void createChain({ mode: entryMode }).then((ok) => {
                if (ok) setEntryOpen(false);
              });
            }}
          />
        </div>
      )}

      {/* "+ 새 프로젝트" — 기존 생성 모달 재사용(신규 모달 0). */}
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, description) => {
          const { project } = await create(name, description);
          if (project) {
            setPickedProject(project.id);
            setCreateOpen(false);
            return project.id;
          }
          return null;
        }}
      />
    </>
  );
}

// ── 경로 조립 ───────────────────────────────────────────────────────

function buildRoutes(
  features: ChainStepFeature[],
  boxes: Record<string, Box>,
  allBoxes: Box[],
  lastToReport: boolean,
): RouteSet | null {
  const cardBoxes = features.map(
    (f) => boxes[CHAIN_STEP_WIDGET_KEY[f]] ?? null,
  );
  if (cardBoxes.some((b) => !b)) return null;

  const lastCard = cardBoxes[cardBoxes.length - 1] as Box;
  // 마지막 두 단계를 같은 위젯이 맡으면 마지막 엣지는 산출물 노드로 간다(S6).
  const reportBox: Box | null = lastToReport
    ? {
        left: lastCard.left + lastCard.width + REPORT_GAP,
        top: lastCard.top,
        width: REPORT_NODE_WIDTH,
        height: REPORT_NODE_HEIGHT,
      }
    : null;

  const routes: ReturnType<typeof routeEdge>[] = [];
  const ports: PortSpec[] = [];

  for (let i = 0; i < features.length - 1; i += 1) {
    const from = cardBoxes[i] as Box;
    const isLast = i === features.length - 2;
    const to = isLast && reportBox ? reportBox : (cardBoxes[i + 1] as Box);
    routes.push(routeEdge(from, to, allBoxes));
    ports.push({
      x: outPortX(from),
      cardTop: from.top,
      role: 'out',
      edge: i,
      toneClass: TONE_BG[features[i]],
    });
    ports.push({ x: inPortX(to), cardTop: to.top, role: 'in', edge: i });
  }

  return { routes, ports, reportBox };
}

// ── 라벨 / 끊김 마크 (z 5) ──────────────────────────────────────────

function ChainMarkers({
  view,
  chain,
  focusHandlers,
}: {
  view: ChainView;
  chain: RouteSet & { kinds: ChainEdgeKind[] };
  focusHandlers: FocusHandlers;
}) {
  const t = useTranslations('Chain');
  const runIdx = runningEdgeIndex(chain.kinds);
  const breakIdx = chain.kinds.findIndex(
    (k) => k === 'paused' || k === 'error',
  );
  const runRoute = runIdx === null ? null : chain.routes[runIdx];
  const breakRoute = breakIdx < 0 ? null : chain.routes[breakIdx];

  return (
    <div className="pointer-events-none absolute inset-0 z-overlay">
      {runRoute && (
        <span
          data-chain-el="run-label"
          {...focusHandlers}
          style={{ left: runRoute.anchor.x, top: runRoute.anchor.y }}
          className="pointer-events-auto absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-pill border-[1.5px] border-lav-line bg-lav-bg px-[11px] py-[3px] text-sm font-extrabold whitespace-nowrap text-lav-text"
        >
          {t('status.running', {
            n: view.currentStep + 1,
            total: view.steps.length,
            step: t(`stepsShort.${view.steps[view.currentStep]?.feature}`),
          })}
        </span>
      )}
      {breakRoute && (
        <span
          data-chain-el="break-mark"
          data-chain-break={chain.kinds[breakIdx]}
          aria-hidden
          style={{ left: breakRoute.anchor.x, top: breakRoute.anchor.y }}
          className={`absolute flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-md font-extrabold ${
            chain.kinds[breakIdx] === 'paused'
              ? 'border-amber bg-paper text-amber-text'
              : 'border-error bg-error-bg text-error-text'
          }`}
        >
          {chain.kinds[breakIdx] === 'paused' ? 'Ⅱ' : '✕'}
        </span>
      )}
    </div>
  );
}

// ── 캡슐 (z 6) ──────────────────────────────────────────────────────

function ChainCapsuleSlot({
  view,
  chain,
  busy,
  projects,
  focusHandlers,
  pickedProject,
  onPickProject,
  onCreateProject,
  onApprove,
  onSkip,
  onCancel,
  onResume,
  onTopUp,
  onDismiss,
  onOpenWidget,
}: {
  view: ChainView;
  chain: RouteSet;
  busy: boolean;
  projects: { id: string; name: string }[];
  focusHandlers: FocusHandlers;
  pickedProject: string | null;
  onPickProject: (id: string) => void;
  onCreateProject: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onResume: () => void;
  onTopUp: () => void;
  onDismiss: () => void;
  onOpenWidget: (key: string) => void;
}) {
  const t = useTranslations('Chain');
  const idx = capsuleEdgeIndex(view);
  const route = idx === null ? null : chain.routes[idx];
  if (!route) return null;

  const cur = view.steps[view.currentStep];
  const stepName = (f?: ChainStepFeature) => (f ? t(`steps.${f}`) : '');
  const costText = (n: number) =>
    n === 0 ? t('costIncluded') : t('cost', { cost: n });

  const props = buildCapsuleProps();

  function buildCapsuleProps(): ChainCapsuleProps | null {
    switch (view.status) {
      case 'awaiting_approval': {
        const needsProject =
          view.projectId === null && cur?.feature === 'interview_ingest';
        const prev = view.steps[view.currentStep - 1];
        return {
          tone: 'amber',
          eyebrow: t('capsule.nextEyebrow', { step: stepName(cur?.feature) }),
          cost: cur && cur.cost > 0 ? costText(cur.cost) : null,
          ...(needsProject
            ? {
                msgA: t('row.project.msgA'),
                msgB: t('row.project.msgB'),
                msgC: t('row.project.msgC'),
              }
            : {
                msgA: prev
                  ? t(`row.awaiting.msgAFrom.${prev.feature}`)
                  : t('row.awaiting.msgAStart'),
                msgB: t('row.awaiting.msgB'),
                msgC: t('row.awaiting.msgC'),
              }),
          onCancel,
          // S2b: 프로젝트를 고르기 전에는 건너뛰기를 **숨긴다**.
          secondary: needsProject
            ? undefined
            : { label: t('action.skip'), onClick: onSkip },
          primary: {
            label:
              cur && cur.cost > 0
                ? t('action.proceedCost', { cost: cur.cost })
                : t('action.proceed'),
            onClick: onApprove,
            locked: needsProject && pickedProject === null,
          },
          busy,
          picker: needsProject
            ? {
                projects,
                selectedId: pickedProject,
                onSelect: onPickProject,
                onCreate: onCreateProject,
              }
            : undefined,
        };
      }
      case 'paused_insufficient_credits':
        return {
          tone: 'amber',
          eyebrow: t('capsule.pausedEyebrow', { step: stepName(cur?.feature) }),
          cost: cur ? t('capsule.needCost', { cost: cur.cost }) : null,
          // 잔액 구절은 creditBalance 가 있을 때만(v1 WRITER-ANSWERS §2).
          msgA:
            typeof view.creditBalance === 'number'
              ? t('row.paused.msgAWithBalance', { balance: view.creditBalance })
              : t('row.paused.msgAStart'),
          msgB: costText(cur?.cost ?? 0),
          msgC: t('row.paused.msgC'),
          onCancel,
          secondary: { label: t('action.resume'), onClick: onResume },
          primary: { label: t('action.topUp'), onClick: onTopUp },
          busy,
        };
      case 'error': {
        const failed = view.steps[view.currentStep];
        const widget =
          CHAIN_STEP_WIDGET_KEY[failed?.feature ?? 'interview_ingest'];
        return {
          tone: 'error',
          eyebrow: t('capsule.errorEyebrow', {
            step: stepName(failed?.feature),
          }),
          cost: null,
          msgA: '',
          // 사유는 steps[i].error 를 그대로. 재시도 버튼은 두지 않는다.
          msgB: failed?.error ?? t('row.error.reasonUnknown'),
          msgC: t('row.error.msgC'),
          secondary: { label: t('action.close'), onClick: onDismiss },
          primary: {
            label: t('action.openWidget', { widget: t(`widget.${widget}`) }),
            onClick: () => onOpenWidget(widget),
          },
          busy,
        };
      }
      case 'done': {
        const last = view.steps[view.steps.length - 1];
        return {
          tone: 'success',
          eyebrow: t('status.completedCount', {
            done: doneCount(view),
            total: view.steps.length,
          }),
          cost: null,
          msgA: '',
          msgB: t('row.done.msgB', { step: stepName(last?.feature) }),
          msgC: t('row.done.msgC'),
          secondary: { label: t('action.close'), onClick: onDismiss },
          primary: {
            label: t('action.openReport'),
            onClick: () =>
              onOpenWidget(CHAIN_STEP_WIDGET_KEY[last?.feature ?? 'topline']),
          },
          busy,
        };
      }
      case 'cancelled': {
        const last = lastDoneStep(view);
        return {
          tone: 'neutral',
          eyebrow: t('status.ended'),
          cost: null,
          msgA: t('row.cancelled.msgA'),
          msgB: last
            ? t('row.cancelled.msgB', { step: stepName(last.feature) })
            : t('row.cancelled.msgBGeneric'),
          msgC: t('row.cancelled.msgC'),
          primary: { label: t('action.close'), onClick: onDismiss },
          busy,
        };
      }
      default:
        // running — 사용자가 할 일이 없으므로 캡슐 없음(엣지 라벨이 말한다).
        return null;
    }
  }

  if (!props) return null;

  return (
    <div
      {...focusHandlers}
      // 아래쪽(엣지에 붙는 쪽) 고정 — 내용이 늘면 위로 자란다.
      style={{ left: route.anchor.x, top: route.anchor.y }}
      className="absolute z-overlay -translate-x-1/2 -translate-y-full"
    >
      <ChainCapsule {...props} />
    </div>
  );
}
