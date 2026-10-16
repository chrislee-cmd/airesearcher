'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLaneHost — 레인 본문 조립 (슬롯 · 도킹 카드 자리 · 세그먼트 · 산출물 노드).

   CD SSOT: `v3/README.md` L0~L9.

   ── 레인 안은 **요약 카드**다 (체인 인스펙터 §1) ────────────────────────
   예전에는 각 단계 자리에 빈 portal 타깃만 두고 604×900 위젯 카드 본체를 그리로
   portal 했다. 체인 인스펙터 PR 에서 레인 안은 **240×300 읽기 전용 요약
   카드**(`ChainStepCard`)가 되고 설정은 오른쪽 인스펙터로 옮겨졌으므로, 더 이상
   위젯 카드를 레인으로 옮기지 않는다 — 카드 본체는 숨은 호스트에 그대로 상시
   마운트돼 있어 **라이브 세션(프로빙·통역)은 끊기지 않고**, 사용자가 그 본체를
   보는 경로는 "결과 보기 ↗" / "진행 보기 ↗" → **기존 풀뷰**다(§7 결과 경로 3곳).

   portal 을 걷어내면서 따라온 이점: React 합성 이벤트가 **원래 컴포넌트 트리**로
   버블하던 함정(LEARNINGS §8-2)과 숨은 래퍼의 `display:none` 함정(§8-3)이 이
   표면에서 통째로 사라진다. 포커스·키보드·선택 링은 전부 레인 안에 실제로 있는
   카드 노드가 들고 다닌다.

   단계 자리 `div` 는 그대로 남는다 — **좌표 판정의 기준**(도킹 드롭 타깃 ·
   click-to-focus 줌 · P1b 팬)이라 보드가 ref 로 들고 있어야 한다.

   세그먼트 종류·캡슐 위치는 v2 의 `deriveEdgeKinds`/`capsuleEdgeIndex` 를 그대로
   쓰고, **미설정 차단**(§3)만 그 위에 `blocked` 로 얹는다 — 설정은 상태가 아니라
   config 라 순수 상태 함수가 알 수 없다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { josa } from '@/lib/korean-particle';
import { usePaywall } from '@/components/paywall-provider';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { CreateProjectModal } from '@/components/interviews-v2/create-project-modal';
import {
  acceptableSteps,
  capsuleEdgeIndex,
  compatOrder,
  deriveEdgeKinds,
  doneCount,
  lastDoneStep,
  isChainStepFeature,
  laneHasReportNode,
  stepCostOf,
  CHAIN_STEP_WIDGET_KEY,
  type ChainEdgeKind,
  type ChainStepFeature,
  type ChainView,
} from '@/lib/chains/view';
import {
  cardLayoutOf,
  chainCardModel,
  derivedValuesOf,
  isChainActive,
  stepContextOf,
  type ChainStepContext,
} from '@/lib/chains/card-state';
import { CHAIN_STEP_NAME_KEY, CHAIN_STEP_TONE } from '@/lib/chains/view';
import { useWidgetStateOf } from '@/components/canvas/shell/widget-state-context';
import { ChainLane, type ChainLaneStatusTone } from './chain-lane';
import { ChainStepCard } from './chain-step-card';
import { useChainInspector } from './chain-inspector-provider';
import { ChainSlot, LANE_CARD_H, LANE_CARD_W } from './chain-slot';

/** 클릭 vs 팬 드래그 — pointerdown→up 이동이 이 픽셀 미만일 때만 클릭. */
const CLICK_MOVE_THRESHOLD = 5;
import { ChainSegment } from './chain-segment';
import { ChainReportNode } from './chain-report-node';
import type { ChainCapsuleProps } from './chain-capsule';
import { useChainLane } from './chain-lane-provider';
import { useWidgetChain } from './widget-chain-provider';

export function ChainLaneHost({
  onOpenWidget,
  narrow = false,
  headerOffset = 0,
  lowZoom = false,
  panMode = false,
  onFocusCard,
  ringWidgetKey = null,
}: {
  onOpenWidget: (widgetKey: string) => void;
  /** §6 900–1023 + 인스펙터 열림 — 레인 헤더 축약. */
  narrow?: boolean;
  /** sticky-left 오프셋(캔버스 px) — 보드가 pan/zoom 에서 계산해 내려준다. */
  headerOffset?: number;
  /**
   * 줌 < FOCUS_THRESHOLD = "탐색 모드"(§9). 이때 카드 위에 click-to-focus
   * 오버레이가 깔리고 **첫 클릭은 포커스 줌인**, 두 번째부터 인스펙터가 열린다
   * (기존 규칙 그대로 — 멀어서 글자가 안 보이는 상태에서 패널을 여는 것은
   * 사용자가 의도한 것이 아니다).
   */
  lowZoom?: boolean;
  /** 스페이스바 팬 모드 — 이때의 클릭은 팬이지 포커스가 아니다. */
  panMode?: boolean;
  /** 저줌 첫 클릭 — 그 카드로 줌인(보드가 pan/zoom 을 소유). */
  onFocusCard?: (widgetKey: string) => void;
  /** P1b 링을 띄울 위젯 key(팔레트에서 레인 위치를 누른 직후 1.2s). */
  ringWidgetKey?: string | null;
}) {
  const t = useTranslations('Chain');
  const tRoot = useTranslations();
  const { view, busy, approve, skip, cancel, resume, dismiss } = useWidgetChain();
  const {
    lane,
    drag,
    locked,
    dissolveLane,
    evaluateUndock,
    undock,
    setDrag,
    registerDockTarget,
    laneBodyRef,
  } = useChainLane();
  const { showPaywall } = usePaywall();
  const { projects, create } = useInterviewV2Projects();
  const inspector = useChainInspector();
  const [picked, setPicked] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** 키보드로 "들어 올린" 카드 — 한 번 더 누르면 빠진다. */
  const [lifted, setLifted] = useState<ChainStepFeature | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 저줌 클릭 판정용 pointerdown 좌표 — 이동거리로 클릭/팬을 가른다.
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  // 단계 자리 ref — **단계마다 같은 함수**여야 한다. 매 렌더 새 콜백을 주면
  // React 가 ref 를 detach(null) → attach(el) 하고, 그 두 번이 전부
  // registerDockTarget → setDockTargets 로 이어져 렌더 루프가 된다 (실측:
  // 도킹 드롭 순간 React #185 "Maximum update depth exceeded" 로 캔버스 트리
  // 전체가 사라졌다). 구성이 바뀔 때만 새로 만든다 — 그때의 detach/attach 한
  // 번은 정상 경로다. (ref 를 렌더 중에 읽어 캐시하는 방식은 금지 —
  // react-hooks 의 "Cannot access refs during render".)
  const laneCards = lane?.cards;
  const dockRefs = useMemo(() => {
    const m: Record<string, (el: HTMLDivElement | null) => void> = {};
    (laneCards ?? []).forEach((f) => {
      m[f] = (el) => registerDockTarget(f, el);
    });
    return m;
  }, [laneCards, registerDockTarget]);

  // ── 카드 키보드: 인스펙터는 Enter/Space, 언도킹은 Delete/Backspace ──
  //
  // CD §10 Done-when 이 **카드 Enter/Space = 인스펙터 열기**를 명시하는데, 그
  // 자리를 쓰고 있던 것이 기존 언도킹 "들어 올리기" 였다(Space 두 번). 두
  // 제스처가 한 키를 나눠 쓸 수 없으므로 CD 가 지정한 쪽이 Enter/Space 를
  // 갖고, 언도킹은 **삭제 의미의 키**(Delete/Backspace)로 옮겼다 — 보수적
  // 선택이고 PR 본문에 명시했다. 두 번 눌러야 빠지는 2단 확인은 그대로다.
  const onCardKeyDown = (feature: ChainStepFeature) =>
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (lifted === feature) {
          if (evaluateUndock(feature).ok) undock(feature);
          setLifted(null);
          setDrag(null);
          return;
        }
        setLifted(feature);
        setDrag({
          feature,
          over: null,
          valid: false,
          verdict: null,
          undocking: evaluateUndock(feature),
        });
        return;
      }
      if (lifted === feature && e.key === 'Escape') {
        e.preventDefault();
        setLifted(null);
        setDrag(null);
      }
    };

  if (!lane) return null;

  const cards = lane.cards;
  const baseKinds: ChainEdgeKind[] = view ? deriveEdgeKinds(view) : [];
  const capsuleIdx = view ? capsuleEdgeIndex(view) : null;
  // 산출물 노드 판정은 **도킹된 카드** 기준이다 — 서버 steps 에는 탑라인이
  // 이미 들어 있어 둘 다 참이지만, 체인 생성 전(1장)에도 같은 규칙이 돈다.
  const showReport = laneHasReportNode(cards);

  // ── 미설정 차단 (§3 — 세 곳이 같은 사실을 말한다) ─────────────────
  // 설정은 **상태가 아니라 config** 라 `deriveEdgeKinds`(상태만 보는 순수
  // 함수)가 알 수 없다. 그래서 여기서 단계별 레이아웃을 한 번 파생해
  //   ① 카드 unset  ② 그 **앞** 세그먼트 `blocked`  ③ 레인 헤더 warn
  // 세 표시의 **단일 근거**로 쓴다 — 셋이 각자 계산하면 갈라진다.
  const steps = view?.steps ?? [];
  const stepContexts: (ChainStepContext | null)[] = steps.map((_, i) => {
    const ctx = stepContextOf(steps, i);
    return ctx ? { ...ctx, config: inspector.configAt(i) } : null;
  });
  const unsetSteps = stepContexts.map(
    (ctx) => !!ctx && cardLayoutOf(ctx) === 'unset',
  );
  /** 미설정 단계의 1-based 번호 — 가장 앞선 것 하나만 헤더가 말한다. */
  const firstUnset = unsetSteps.indexOf(true);
  const blockedStep = firstUnset >= 0 ? firstUnset + 1 : null;

  // 엣지 i 는 steps[i] → steps[i+1] 이다. 도착 단계가 미설정이면 차단 표현.
  const kinds: ChainEdgeKind[] = baseKinds.map((kind, i) =>
    unsetSteps[i + 1] ? 'blocked' : kind,
  );

  // ── 헤더 ─────────────────────────────────────────────────────────
  const { statusText, statusTone } = laneStatus(view, cards.length, t, blockedStep);
  const costNote = buildCostNote(cards, t);

  const chainActive = isChainActive(view?.status ?? '');
  const projectDocumentCount = (() => {
    if (!view?.projectId) return null;
    const p = projects.find((x) => x.id === view.projectId);
    return p ? p.document_count : null;
  })();

  // ── 본문 ─────────────────────────────────────────────────────────
  const items: React.ReactNode[] = [];
  cards.forEach((f, i) => {
    if (i > 0) {
      const edgeIdx = i - 1;
      items.push(
        <ChainSegment
          key={`seg-${edgeIdx}`}
          kind={kinds[edgeIdx] ?? 'pending'}
          label={
            kinds[edgeIdx] === 'running' && view
              ? t('status.running', {
                  n: view.currentStep + 1,
                  total: view.steps.length,
                  step: t(`stepsShort.${view.steps[view.currentStep]?.feature}`),
                })
              : null
          }
          capsule={
            capsuleIdx === edgeIdx && view
              ? buildCapsule(view, {
                  t,
                  projects: projects.map((p) => ({ id: p.id, name: p.name })),
                  picked,
                  onPick: setPicked,
                  onCreateProject: () => setCreateOpen(true),
                  busy,
                  onApprove: () => {
                    void approve(view.currentStep, picked);
                    setPicked(null);
                  },
                  onSkip: () => void skip(view.currentStep),
                  onCancel: () => void cancel(),
                  onResume: () => void resume(),
                  onTopUp: showPaywall,
                  onDismiss: dismiss,
                  onOpenWidget,
                })
              : null
          }
          reducedMotion={reducedMotion}
        />,
      );
    }
    // 단계 자리 — **좌표 판정의 기준**이라 ref 를 유지한다(도킹 드롭 타깃 ·
    // click-to-focus 줌 · P1b 팬). 안에 요약 카드가 실제로 들어간다.
    // 언도킹이 거절된 카드(가운데)는 **자기 자리 위에** 사유를 띄운다(CD
    // Interactions) — 겹침 순서는 기존 `z-overlay` 를 쓴다(LEARNINGS §4).
    const undockReject =
      drag?.feature === f && drag.undocking && !drag.undocking.ok
        ? drag.undocking
        : null;
    const stepIndex = steps.findIndex((st) => st.feature === f);
    items.push(
      <div
        key={`dock-${f}`}
        ref={dockRefs[f]}
        data-chain="dock-target"
        data-chain-dock={f}
        data-chain-undock={undockReject ? 'rejected' : undefined}
        style={{ width: LANE_CARD_W, height: LANE_CARD_H }}
        className="relative shrink-0"
      >
        <LaneCard
          feature={f}
          stepIndex={stepIndex}
          ctx={stepIndex >= 0 ? stepContexts[stepIndex] : null}
          cost={stepIndex >= 0 ? (steps[stepIndex]?.cost ?? 0) : 0}
          error={stepIndex >= 0 ? (steps[stepIndex]?.error ?? null) : null}
          updatedAt={view?.updatedAt ?? null}
          projectDocumentCount={projectDocumentCount}
          chainActive={chainActive}
          laneIndex={i}
          laneTotal={cards.length}
          selected={stepIndex >= 0 && inspector.selectedIndex === stepIndex}
          onOpen={() => {
            if (stepIndex >= 0) inspector.toggle(stepIndex);
          }}
          onOpenResult={() => onOpenWidget(CHAIN_STEP_WIDGET_KEY[f])}
          onCardKeyDown={onCardKeyDown(f)}
          ring={ringWidgetKey === CHAIN_STEP_WIDGET_KEY[f]}
        />
        {/* click-to-focus 오버레이 — 저줌(탐색 모드)에서만(§9). 드래그 중에는
            globals.css 가 `[data-palette-dragging]` 아래에서
            `pointer-events: none` 을 줘 드롭이 성립한다(LEARNINGS §2-1 · §8-8).
            판정은 **기하**다: pointerdown 좌표와 pointerup 좌표의 거리만 본다
            (enter/leave 이벤트 0). */}
        {lowZoom && (
          <div
            data-canvas-focus-overlay
            className="absolute inset-0 z-overlay cursor-zoom-in"
            onPointerDown={(e) => {
              clickStartRef.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const start = clickStartRef.current;
              clickStartRef.current = null;
              if (!start || panMode) return;
              const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
              if (moved <= CLICK_MOVE_THRESHOLD) {
                onFocusCard?.(CHAIN_STEP_WIDGET_KEY[f]);
              }
            }}
          />
        )}
        {undockReject && (
          <div
            data-chain="undock-reject"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 z-overlay flex flex-col items-center justify-center gap-2.5 rounded-sm border-[1.5px] border-dashed border-soft-err-dot bg-soft-err-bg/95"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-soft-err-dot text-xl font-extrabold text-soft-err-fg">
              <span aria-hidden>✕</span>
            </div>
            <div className="px-4 text-center text-md font-bold text-soft-err-fg">
              {t(
                `dock.${undockReject.error === 'locked' ? 'locked' : 'middleUndock'}`,
              )}
            </div>
          </div>
        )}
      </div>,
    );
  });

  // 마지막: 산출물 노드(더 이을 단계 없음) 또는 빈/드롭 슬롯.
  if (showReport) {
    const last = view?.steps[view.steps.length - 1];
    items.push(
      <ChainSegment
        key="seg-report"
        kind={kinds[kinds.length - 1] ?? 'pending'}
        capsule={
          view && capsuleIdx === kinds.length - 1
            ? buildCapsule(view, {
                t,
                projects: [],
                picked: null,
                onPick: () => {},
                onCreateProject: () => {},
                busy,
                onApprove: () => void approve(view.currentStep, null),
                onSkip: () => void skip(view.currentStep),
                onCancel: () => void cancel(),
                onResume: () => void resume(),
                onTopUp: showPaywall,
                onDismiss: dismiss,
                onOpenWidget,
              })
            : null
        }
        reducedMotion={reducedMotion}
      />,
      <ChainReportNode
        key="report"
        state={last?.status === 'done' ? 'done' : 'pending'}
      />,
    );
  } else if (!locked) {
    // 아직 더 받을 수 있다 — 빈 슬롯(또는 드래그 피드백).
    if (cards.length > 0) {
      items.push(<ChainSegment key="seg-next" kind="pending" reducedMotion={reducedMotion} />);
    }
    items.push(
      <div key="slot" className="shrink-0">
        <ChainSlot {...slotProps(drag, cards, t, tRoot)} />
      </div>,
    );
  }

  return (
    <>
      <ChainLane
        title={t('lane.title')}
        mode={view?.mode ?? 'approve'}
        modeEditable={!locked}
        onModeChange={() => {
          /* 모드 변경은 생성 시점에 정해진다 — 조립 중 전환은 A″ 범위. */
        }}
        statusText={statusText}
        statusTone={statusTone}
        lockNote={locked ? t('lane.lockNote') : null}
        costNote={costNote}
        action={
          locked
            ? { label: t('action.cancel'), onClick: () => void cancel() }
            : { label: t('lane.dissolve'), onClick: dissolveLane }
        }
        bodyRef={laneBodyRef}
        narrow={narrow}
        headerOffset={headerOffset}
      >
        {items}
      </ChainLane>

      {/* 언도킹 키보드 안내 — 시각 피드백은 카드 위 사유 박스가 이미 한다. */}
      <div aria-live="polite" className="sr-only">
        {lifted && drag?.undocking
          ? drag.undocking.ok
            ? t('lane.dissolve')
            : t(
                `dock.${drag.undocking.error === 'locked' ? 'locked' : 'middleUndock'}`,
              )
          : ''}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, description) => {
          const { project } = await create(name, description);
          if (project) {
            setPicked(project.id);
            setCreateOpen(false);
            return project.id;
          }
          return null;
        }}
      />
    </>
  );
}

// ── 레인 안 요약 카드 ───────────────────────────────────────────────
//
// 분리된 이유는 **훅**이다: 실행 중 진척·현재 작업은 위젯 상태 채널
// (`useWidgetStateOf`)에서 오고, 훅은 반복문 안에서 호출할 수 없다. 카드 1장당
// 컴포넌트 1개면 그 채널을 각자 구독하면서도 규칙을 지킨다.

function LaneCard({
  feature,
  stepIndex,
  ctx,
  cost,
  error,
  updatedAt,
  projectDocumentCount,
  chainActive,
  laneIndex,
  laneTotal,
  selected,
  onOpen,
  onOpenResult,
  onCardKeyDown,
  ring,
}: {
  feature: ChainStepFeature;
  /** `view.steps` 안의 index. 서버 행이 아직 없으면 -1. */
  stepIndex: number;
  ctx: ChainStepContext | null;
  cost: number;
  error: string | null;
  updatedAt: string | null;
  projectDocumentCount: number | null;
  chainActive: boolean;
  /** 레인 안 순서(서버 행이 없을 때의 단계 번호 폴백 — 팔레트와 같은 규칙). */
  laneIndex: number;
  laneTotal: number;
  selected: boolean;
  onOpen: () => void;
  onOpenResult: () => void;
  /** 카드가 쓰지 않는 키 입력 — 언도킹(Delete/Backspace) 경로. */
  onCardKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  ring: boolean;
}) {
  const tRoot = useTranslations();
  const widgetKey = CHAIN_STEP_WIDGET_KEY[feature];
  const widgetState = useWidgetStateOf(widgetKey);

  // 서버 행이 아직 없는 구간(카드 1장 — `syncComposition` 은 2단계부터 POST)
  // 에서도 카드가 보여야 한다. 그때는 레인 순서로 맥락을 만든다.
  const effective: ChainStepContext =
    ctx ??
    {
      feature,
      position: laneIndex,
      upstream: null,
      status: 'pending',
      config: {},
    };

  const derived = derivedValuesOf({ ctx: effective, projectDocumentCount });
  const running =
    widgetState.kind === 'running' ? widgetState : null;
  const model = chainCardModel({
    ctx: effective,
    t: tRoot,
    derived,
    cost,
    progress:
      running && typeof running.progress === 'number' ? running.progress : null,
    runLabel: running?.label ?? null,
    doneAt: effective.status === 'done' ? formatClock(updatedAt) : null,
    error,
  });

  void laneTotal;
  void chainActive;
  void stepIndex;

  return (
    <ChainStepCard
      model={model}
      widgetKey={widgetKey}
      name={tRoot(`Chain.${CHAIN_STEP_NAME_KEY[feature]}`)}
      tone={CHAIN_STEP_TONE[feature]}
      selected={selected}
      selectedLabel={tRoot('Chain.card.editing')}
      onOpen={onOpen}
      onOpenResult={onOpenResult}
      onCardKeyDown={onCardKeyDown}
      ring={ring}
      ariaLabel={tRoot('Chain.card.aria', {
        chain: tRoot('Chain.lane.title'),
        n: effective.position + 1,
        name: tRoot(`Chain.${CHAIN_STEP_NAME_KEY[feature]}`),
      })}
    />
  );
}

/**
 * 시각 표기 — 완료 카드 푸터("완료 시각")와 인스펙터 하단이 쓴다.
 *
 * 로케일 포맷을 쓰지 않는 이유: 이 값은 SSR 과 클라이언트의 시간대가 다르면
 * 하이드레이션 불일치를 만든다. 레인은 클라이언트 fetch 결과(`view`)가 와야
 * 그려지므로 실제로 SSR 출력이 없지만, 시각 한 줄 때문에 그 불변식에 의존하지
 * 않도록 `Intl` 을 브라우저에서만 쓴다(서버 렌더 시 빈 값).
 */
function formatClock(iso: string | null): string | null {
  if (!iso || typeof window === 'undefined') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// ── 슬롯 상태 ───────────────────────────────────────────────────────

function slotProps(
  drag: ReturnType<typeof useChainLane>['drag'],
  cards: ChainStepFeature[],
  t: (key: string, values?: Record<string, string | number>) => string,
  tRoot: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!drag || drag.over === null) {
    return {
      state: 'empty' as const,
      chips: acceptableSteps(cards),
    };
  }
  if (drag.valid) {
    return {
      state: 'valid' as const,
      toneFeature: drag.feature as ChainStepFeature,
      title: t('lane.slotValidTitle', { n: cards.length + 1 }),
    };
  }
  return {
    state: 'invalid' as const,
    title: dockReason(drag.verdict, drag.feature, t, tRoot),
    chips: compatOrder(),
  };
}

/**
 * 거절 사유 — A′ 의 **에러 코드**로 분기한다(문구 파싱 금지).
 *
 * 위젯 이름은 **로케일 문자열**로 넣는다: 단계면 `Chain.steps.*`, 체인에 못
 * 들어가는 위젯(unknown_step)이면 사이드바 이름(`Sidebar.*`)으로 폴백한다 —
 * 원시 feature 키("transcripts")가 사용자에게 보이면 안 된다.
 *
 * ko 문구는 이름 뒤에 조사가 붙으므로(`{widget}{josa}`) 받침을 보고 고른다.
 * en/ja/th 문구에는 `{josa}` 자리가 없어 영향이 0이다(next-intl 은 쓰지 않는
 * 값을 무시한다).
 */
export function dockReason(
  verdict: ReturnType<typeof useChainLane>['drag'] extends infer D
    ? D extends { verdict: infer V }
      ? V
      : never
    : never,
  feature: string,
  t: (key: string, values?: Record<string, string | number>) => string,
  tRoot?: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (!verdict || verdict.ok) return '';
  if (verdict.error === 'incompatible_steps' && verdict.from && verdict.to) {
    const to = t(`steps.${verdict.to}`);
    return t('dock.incompatible_steps', {
      from: t(`steps.${verdict.from}`),
      to,
      josa: josa(to),
    });
  }
  const name = stepLabel(feature, t, tRoot);
  return t(`dock.${verdict.error}`, { widget: name, josa: josa(name) });
}

/** 단계면 체인 이름, 아니면 사이드바 이름. 어느 쪽도 없으면 키 그대로. */
export function stepLabel(
  feature: string,
  t: (key: string, values?: Record<string, string | number>) => string,
  tRoot?: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (isChainStepFeature(feature)) return t(`steps.${feature}`);
  if (!tRoot) return feature;
  try {
    return tRoot(`Sidebar.${feature}`);
  } catch {
    return feature;
  }
}

// ── 헤더 상태 ───────────────────────────────────────────────────────

export function laneStatus(
  view: ChainView | null,
  cardCount: number,
  t: (key: string, values?: Record<string, string | number>) => string,
  /** 미설정 단계의 1-based 번호. null 이면 전부 설정됨. */
  blockedStep: number | null = null,
): { statusText: string; statusTone: ChainLaneStatusTone } {
  // 미설정이 있으면 그것이 **가장 급한 사실**이다 — 실행 중·완료 같은 진행
  // 상태보다 앞서 말한다(§3: 카드 · 세그먼트 · 헤더가 같은 사실을 함께 말한다).
  // 단 이미 돌고 있거나 끝난 체인에서는 미설정이 더 이상 막는 것이 없다.
  if (
    blockedStep !== null &&
    view &&
    (view.status === 'awaiting_approval' ||
      view.status === 'paused_insufficient_credits')
  ) {
    return {
      statusText: t('lane.statusBlocked', { n: blockedStep }),
      statusTone: 'amber',
    };
  }
  if (!view) {
    return cardCount === 0
      ? { statusText: t('lane.statusEmpty'), statusTone: 'mute' }
      : { statusText: t('lane.statusSteps', { n: cardCount }), statusTone: 'mute' };
  }
  switch (view.status) {
    case 'running':
      // 커서가 진입 단계(0)면 "준비됨" — 진입은 서버가 kick 할 것이 없는 수동
      // 단계라, 사용자가 그 위젯을 돌리기 전까지는 대기다(CD L3). auto 모드는
      // 생성 즉시 이 상태로 들어온다.
      return view.currentStep === 0
        ? { statusText: t('lane.statusReady'), statusTone: 'ink' }
        : {
            statusText: t('status.running', {
              n: view.currentStep + 1,
              total: view.steps.length,
              step: t(`stepsShort.${view.steps[view.currentStep]?.feature}`),
            }),
            statusTone: 'processing',
          };
    case 'awaiting_approval':
      // 같은 이유로 커서 0 = 조립을 막 끝낸 approve 모드 레인 = L3 "준비됨".
      // 승인 대기 문구(amber)는 **중간 단계로 들어갈 때**(L5)만 쓴다 — 조립
      // 직후에 그걸 띄우면 사용자가 누를 승인 캡슐도 없이 대기로 보인다
      // (capsuleEdgeIndex 도 currentStep-1 = -1 로 캡슐을 안 그린다).
      return view.currentStep === 0
        ? { statusText: t('lane.statusReady'), statusTone: 'ink' }
        : { statusText: t('status.awaiting'), statusTone: 'amber' };
    case 'paused_insufficient_credits':
      return { statusText: t('status.paused'), statusTone: 'amber' };
    case 'error':
      return { statusText: t('status.ended'), statusTone: 'error' };
    case 'done':
      return {
        statusText: t('status.completedCount', {
          done: doneCount(view),
          total: view.steps.length,
        }),
        statusTone: 'success',
      };
    default:
      return { statusText: t('status.ended'), statusTone: 'mute' };
  }
}

/** "세션 후 💎1 + 파일당 25" — 진입 단계를 뺀 나머지 비용. */
function buildCostNote(
  cards: ChainStepFeature[],
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  if (cards.length < 2) return null;
  const rest = cards.slice(1);
  const perFile = rest.includes('interview_ingest')
    ? stepCostOf('interview_ingest')
    : 0;
  const fixed = rest
    .filter((f) => f !== 'interview_ingest')
    .reduce((sum, f) => sum + stepCostOf(f), 0);
  return perFile > 0
    ? t('lane.costNote', { fixed, perFile })
    : t('lane.costNoteFixed', { fixed });
}

// ── 캡슐 (v2 그대로 — 배치만 세그먼트 안으로) ────────────────────────

type CapsuleDeps = {
  t: (key: string, values?: Record<string, string | number>) => string;
  projects: { id: string; name: string }[];
  picked: string | null;
  onPick: (id: string) => void;
  onCreateProject: () => void;
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onResume: () => void;
  onTopUp: () => void;
  onDismiss: () => void;
  onOpenWidget: (key: string) => void;
};

function buildCapsule(view: ChainView, d: CapsuleDeps): ChainCapsuleProps | null {
  const { t } = d;
  const cur = view.steps[view.currentStep];
  const stepName = (f?: ChainStepFeature) => (f ? t(`steps.${f}`) : '');
  const costText = (n: number) =>
    n === 0 ? t('costIncluded') : t('cost', { cost: n });

  switch (view.status) {
    case 'awaiting_approval': {
      const needsProject =
        view.projectId === null && cur?.feature === 'interview_ingest';
      const prev = view.steps[view.currentStep - 1];
      return {
        tone: 'amber',
        glyph: '?',
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
        onCancel: d.onCancel,
        secondary: needsProject
          ? undefined
          : { label: t('action.skip'), onClick: d.onSkip },
        primary: {
          label:
            cur && cur.cost > 0
              ? t('action.proceedCost', { cost: cur.cost })
              : t('action.proceed'),
          onClick: d.onApprove,
          locked: needsProject && d.picked === null,
        },
        busy: d.busy,
        picker: needsProject
          ? {
              projects: d.projects,
              selectedId: d.picked,
              onSelect: d.onPick,
              onCreate: d.onCreateProject,
            }
          : undefined,
      };
    }
    case 'paused_insufficient_credits':
      return {
        tone: 'amber',
        glyph: 'Ⅱ',
        eyebrow: t('capsule.pausedEyebrow', { step: stepName(cur?.feature) }),
        cost: cur ? t('capsule.needCost', { cost: cur.cost }) : null,
        msgA:
          typeof view.creditBalance === 'number'
            ? t('row.paused.msgAWithBalance', { balance: view.creditBalance })
            : t('row.paused.msgAStart'),
        msgB: costText(cur?.cost ?? 0),
        msgC: t('row.paused.msgC'),
        onCancel: d.onCancel,
        secondary: { label: t('action.resume'), onClick: d.onResume },
        primary: { label: t('action.topUp'), onClick: d.onTopUp },
        busy: d.busy,
      };
    case 'error': {
      const failed = view.steps[view.currentStep];
      const widget =
        CHAIN_STEP_WIDGET_KEY[failed?.feature ?? 'interview_ingest'];
      return {
        tone: 'error',
        glyph: '✕',
        eyebrow: t('capsule.errorEyebrow', { step: stepName(failed?.feature) }),
        cost: null,
        msgA: '',
        msgB: failed?.error ?? t('row.error.reasonUnknown'),
        msgC: t('row.error.msgC'),
        secondary: { label: t('action.close'), onClick: d.onDismiss },
        primary: {
          label: t('action.openWidget', { widget: t(`widget.${widget}`) }),
          onClick: () => d.onOpenWidget(widget),
        },
        busy: d.busy,
      };
    }
    case 'done': {
      const last = view.steps[view.steps.length - 1];
      return {
        tone: 'success',
        glyph: '✓',
        eyebrow: t('status.completedCount', {
          done: doneCount(view),
          total: view.steps.length,
        }),
        cost: null,
        msgA: '',
        msgB: t('row.done.msgB', { step: stepName(last?.feature) }),
        msgC: t('row.done.msgC'),
        secondary: { label: t('action.close'), onClick: d.onDismiss },
        primary: {
          label: t('action.openReport'),
          onClick: () =>
            d.onOpenWidget(CHAIN_STEP_WIDGET_KEY[last?.feature ?? 'topline']),
        },
        busy: d.busy,
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
        primary: { label: t('action.close'), onClick: d.onDismiss },
        busy: d.busy,
      };
    }
    default:
      return null;
  }
}
