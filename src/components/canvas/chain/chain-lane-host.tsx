'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLaneHost — 레인 본문 조립 (슬롯 · 도킹 카드 자리 · 세그먼트 · 산출물 노드).

   CD SSOT: `v3/README.md` L0~L9.

   **도킹 카드는 여기서 렌더하지 않는다.** 카드를 다른 부모로 옮기면 React 가
   remount 해 라이브 세션(프로빙·통역)이 끊기기 때문이다. 대신 각 단계 자리에
   빈 **portal 타깃**만 두고, canvas-board 가 항상 마운트해 둔 카드를 그 타깃으로
   portal 한다 — 레포가 전체보기에서 이미 쓰는 "always-mounted 카드 + portal"
   패턴 그대로다(fullview-shell-context 주석 참조).

   세그먼트 종류·캡슐 위치는 v2 의 `deriveEdgeKinds`/`capsuleEdgeIndex` 를 그대로
   쓴다 — 순수 함수라 체인 구성이 자유로워져도 유효하다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
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
import { ChainLane, type ChainLaneStatusTone } from './chain-lane';
import { ChainSlot, LANE_CARD_H, LANE_CARD_W } from './chain-slot';
import { ChainSegment } from './chain-segment';
import { ChainReportNode } from './chain-report-node';
import type { ChainCapsuleProps } from './chain-capsule';
import { useChainLane } from './chain-lane-provider';
import { useWidgetChain } from './widget-chain-provider';

export function ChainLaneHost({
  onOpenWidget,
}: {
  onOpenWidget: (widgetKey: string) => void;
}) {
  const t = useTranslations('Chain');
  const tRoot = useTranslations();
  const { view, busy, approve, skip, cancel, resume, dismiss } = useWidgetChain();
  const {
    lane,
    drag,
    locked,
    dissolveLane,
    registerDockTarget,
    laneBodyRef,
  } = useChainLane();
  const { showPaywall } = usePaywall();
  const { projects, create } = useInterviewV2Projects();
  const [picked, setPicked] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 포털 타깃 ref — **단계마다 같은 함수**여야 한다. 매 렌더 새 콜백을 주면
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

  if (!lane) return null;

  const cards = lane.cards;
  const kinds: ChainEdgeKind[] = view ? deriveEdgeKinds(view) : [];
  const capsuleIdx = view ? capsuleEdgeIndex(view) : null;
  // 산출물 노드 판정은 **도킹된 카드** 기준이다 — 서버 steps 에는 탑라인이
  // 이미 들어 있어 둘 다 참이지만, 체인 생성 전(1장)에도 같은 규칙이 돈다.
  const showReport = laneHasReportNode(cards);

  // ── 헤더 ─────────────────────────────────────────────────────────
  const { statusText, statusTone } = laneStatus(view, cards.length, t);
  const costNote = buildCostNote(cards, t);

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
    // 도킹 카드 자리 — 빈 portal 타깃(카드는 board 가 여기로 portal 한다).
    // 언도킹이 거절된 카드(가운데)는 **자기 자리 위에** 사유를 띄운다(CD
    // Interactions). 카드 DOM 은 portal 로 뒤에 붙으므로 겹침 순서를 z 토큰으로
    // 정한다 — 새 층을 만들지 않고 기존 `z-overlay` 를 쓴다(LEARNINGS §4).
    const undockReject =
      drag?.feature === f && drag.undocking && !drag.undocking.ok
        ? drag.undocking
        : null;
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
        {undockReject && (
          <div
            data-chain="undock-reject"
            aria-live="polite"
            style={{ borderRadius: 'var(--widget-card-frame-radius)' }}
            className="pointer-events-none absolute inset-0 z-overlay flex flex-col items-center justify-center gap-5 border-[3px] border-dashed border-error bg-error-bg/90"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-[2.5px] border-error text-display font-extrabold text-error-text">
              <span aria-hidden>✕</span>
            </div>
            <div className="px-10 text-center text-3xl font-extrabold text-error-text">
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
      >
        {items}
      </ChainLane>

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
): { statusText: string; statusTone: ChainLaneStatusTone } {
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
