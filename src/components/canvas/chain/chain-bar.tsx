'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainBar — 캔버스 상단 체인 바 (fresh 프레젠테이션).

   CD SSOT: `design-handoff/widget-chain/widget-chain.dc.html` C2 +
   `BUILD-SPEC.md` §1.1~1.3 · §3 상태 매트릭스. 외형 충돌 시 .dc.html 이 이긴다
   (규칙 2c AUTHORITY) — CD 절대값은 토큰으로 승격하고 DS 기본값으로 굽히지
   않는다.

   경계: **프레젠테이션 전부 · 데이터 0.** `ChainView` + 콜백만 받는다. 페칭·
   realtime 구독·액션 호출은 컨테이너(chain-bar-host)가 소유한다. 내부 state 는
   피커 열림 여부 하나(순수 UI state).

   §0 Q1 결정: 승인 모먼트는 **이 바의 아래 행**이다 — 모달/카드 인라인/토스트
   전부 기각. 체인 위젯들이 캔버스에서 비인접하므로(프로빙과 전사 사이에 통역)
   카드에 띄우면 그 카드를 보고 있어야만 알아챈다.

   유령 상태 금지(§3): paused·error·cancelled 바에는 processing 색·링·펄스가
   **하나도** 없어야 하고, 상태 텍스트에 "진행" 이라는 말을 쓰지 않는다. 노드
   접기는 데이터측(`lib/chains/view.ts toChainView`)이 이미 보장하고, 여기선
   상태→색 매핑이 그 절반을 담당한다.

   지어내지 않은 것(HANDOFF §3): 확인 모달 · 카운트다운 · 바 접기 버튼 ·
   Navigator 표시. 전부 의도적으로 없다.
   ──────────────────────────────────────────────────────────────────── */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { PickerTrigger, SingleSelectPanel } from '@/components/ui/picker';
import { usePopoverBase } from '@/components/ui/use-popover-base';
import {
  CHAIN_STEP_TONE,
  CHAIN_STEP_WIDGET_KEY,
  currentStepOf,
  doneCount,
  lastDoneStep,
  type ChainNodeStatus,
  type ChainStepFeature,
  type ChainStepView,
  type ChainView,
} from '@/lib/chains/view';

// 바 프레임 실치수(BUILD-SPEC §1.1) — 캔버스 폭이 좁으면 max-w-full 로 줄어든다
// (바깥 W 는 캔버스 소유, 안쪽 radius/border/shadow 만 CD 절대값).
const BAR_WIDTH = 1040;
// 트랙 칸 폭 — 노드 라벨("인터뷰 어시스턴트")이 2줄로 접히는 기준(§1.2).
const NODE_CELL_WIDTH = 118;

type StatusTone = 'processing' | 'amber' | 'error' | 'success' | 'mute';

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  processing: 'text-lav-text',
  amber: 'text-amber-text',
  error: 'text-error-text',
  success: 'text-success-text',
  mute: 'text-mute',
};

type RowTone = 'amber' | 'error' | 'success' | 'neutral';

// 아래 행 bg + 상단 구분선(1.5px). 구분선 색은 행 톤과 짝 — §1.1 "아래 행(조건부)".
const ROW_TONE_CLASS: Record<RowTone, string> = {
  amber: 'bg-warning-bg border-amber-line',
  error: 'bg-error-bg border-error-line',
  success: 'bg-success-bg border-success-line',
  neutral: 'bg-paper-soft border-ink/[0.12]',
};

// ── 트랙 노드 (§1.3 · 6종 + 표시전용 paused) ────────────────────────────────

const NODE_GLYPH: Record<ChainNodeStatus, string> = {
  done: '✓',
  running: '•',
  awaiting: '?',
  pending: '',
  skipped: '–',
  error: '!',
  paused: 'Ⅱ',
};

// 노드 원의 테두리 + 글리프 색. 채움(bg)은 위젯 톤이라 별도(TONE_BG).
const NODE_RIM_CLASS: Record<ChainNodeStatus, string> = {
  done: 'border-2 border-ink text-ink',
  running: 'border-2 border-ink text-ink',
  awaiting: 'border-2 border-dashed border-amber text-amber-text',
  pending: 'border-[1.5px] border-dashed border-line-empty text-ink',
  skipped: 'border-[1.5px] border-ink/[0.24] text-mute-soft',
  error: 'border-2 border-error text-error-text',
  paused: 'border-2 border-amber text-amber-text',
};

const NODE_LABEL_CLASS: Record<ChainNodeStatus, string> = {
  done: 'font-bold text-ink',
  running: 'font-extrabold text-lav-text',
  awaiting: 'font-extrabold text-amber-text',
  pending: 'font-bold text-mute-soft',
  skipped: 'font-bold text-mute-soft line-through',
  error: 'font-extrabold text-error-text',
  paused: 'font-extrabold text-amber-text',
};

const TONE_BG: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

// 노드 채움 — done/running 만 "그 단계를 맡은 위젯 톤"으로 채운다(§1.2). 나머지는
// 상태 표면(대기 amber 틴트 · 멈춤/대기중 paper · 건너뜀 disabled · 실패 error 틴트).
function nodeFillClass(step: ChainStepView): string {
  switch (step.status) {
    case 'done':
    case 'running':
      return TONE_BG[CHAIN_STEP_TONE[step.feature]];
    case 'awaiting':
      return 'bg-warning-bg';
    case 'skipped':
      return 'bg-surface-disabled';
    case 'error':
      return 'bg-error-bg';
    default:
      return 'bg-paper';
  }
}

function ChainNode({
  step,
  label,
  costLabel,
}: {
  step: ChainStepView;
  label: string;
  costLabel: string;
}) {
  const dimCost = step.status === 'pending' || step.status === 'skipped';
  return (
    <div
      data-chain-node={step.status}
      data-chain-node-feature={step.feature}
      className="flex shrink-0 flex-col items-center gap-[5px]"
      style={{ width: NODE_CELL_WIDTH }}
    >
      <div
        // 링 + 펄스는 running 노드에만 (§1.3 · globals.css .chain-node-ring —
        // 링은 클래스가 항상 그리고 reduced-motion 에서 애니메이션만 꺼진다).
        className={`flex h-7 w-7 items-center justify-center rounded-full text-md font-extrabold ${NODE_RIM_CLASS[step.status]} ${nodeFillClass(step)} ${
          step.status === 'running' ? 'chain-node-ring' : ''
        }`}
      >
        <span aria-hidden>{NODE_GLYPH[step.status]}</span>
      </div>
      <div
        // leading 1.3 · 비용행 16px = CD 노드 칸 실측(68.95px) 복원. 기본
        // leading(tight/1.3333)로 두면 칸이 ~3px 낮아 바 전체 높이가 어긋난다.
        className={`text-center text-sm leading-[1.3] ${NODE_LABEL_CLASS[step.status]}`}
      >
        {label}
      </div>
      <div
        className={`font-mono text-xs leading-4 font-bold ${dimCost ? 'text-faint' : 'text-mute-soft'}`}
      >
        {costLabel}
      </div>
    </div>
  );
}

// ── 바 ─────────────────────────────────────────────────────────────────────

export type ChainBarProject = { id: string; name: string };

export type ChainBarProps = {
  view: ChainView;
  /** 현재(승인 대기) 단계를 승인 — 그 단계를 지금 돌린다. */
  onApprove: (stepIndex: number) => void;
  /** 현재 단계를 건너뛰고 다음으로. */
  onSkip: (stepIndex: number) => void;
  /** 체인 종료 — 확인 모달 없음(§4: 데이터 손실 0, 결과는 각 위젯에 남는다). */
  onCancel: () => void;
  /** 멈춘 체인 재개(충전 없이 누르면 같은 멈춤으로 돌아온다 — B5 note). */
  onResume: () => void;
  /** 크레딧 충전 진입 — 기존 전역 충전 경로. */
  onTopUp: () => void;
  /** 위젯 전체보기 열기(B6 실패 단계 · B8 보고서). */
  onOpen: (widgetKey: string) => void;
  /** 종결 바 제거 — 자동으로 사라지지 않고 "닫기" 로만(§4). */
  onDismiss: () => void;

  // ── B3 프로젝트 피커 (데이터는 컨테이너 소유 — WRITER-ANSWERS §5) ──
  projects?: ChainBarProject[];
  pickedProjectId?: string | null;
  onPickProject?: (projectId: string) => void;
  onCreateProject?: () => void;

  /** 액션 in-flight — 버튼 이중 클릭 방지. */
  busy?: boolean;
};

export function ChainBar({
  view,
  onApprove,
  onSkip,
  onCancel,
  onResume,
  onTopUp,
  onOpen,
  onDismiss,
  projects = [],
  pickedProjectId = null,
  onPickProject,
  onCreateProject,
  busy = false,
}: ChainBarProps) {
  const t = useTranslations('Chain');
  const total = view.steps.length;
  const current = currentStepOf(view);
  const done = doneCount(view);

  const stepLabel = (feature: ChainStepFeature) => t(`steps.${feature}`);
  const shortLabel = (feature: ChainStepFeature) => t(`stepsShort.${feature}`);
  const costLabel = (cost: number) =>
    cost === 0 ? t('costIncluded') : t('cost', { cost });

  // ── 상태 텍스트 (§3) ──────────────────────────────────────────────────
  let statusText: string;
  let statusTone: StatusTone;
  if (view.status === 'running') {
    statusText = t('status.running', {
      n: view.currentStep + 1,
      total,
      step: current ? shortLabel(current.feature) : '',
    });
    statusTone = 'processing';
  } else if (view.status === 'awaiting_approval') {
    statusText = t('status.completedCount', { done, total });
    statusTone = 'amber';
  } else if (view.status === 'paused_insufficient_credits') {
    statusText = t('status.paused');
    statusTone = 'amber';
  } else if (view.status === 'error') {
    statusText = t('status.ended');
    statusTone = 'error';
  } else if (view.status === 'done') {
    statusText = t('status.completedCount', { done, total });
    statusTone = 'success';
  } else {
    statusText = t('status.ended');
    statusTone = 'mute';
  }

  // ── 아래 행 (§3) ─────────────────────────────────────────────────────
  // B3 = 승인 대기 + projectId 미정 + 다음 단계가 프로젝트를 요구(interview_ingest).
  const needsProject =
    view.status === 'awaiting_approval' &&
    view.projectId === null &&
    current?.feature === 'interview_ingest';
  const projectResolved = view.projectId !== null || pickedProjectId !== null;

  const row = buildRow();

  function buildRow(): {
    tone: RowTone;
    msgA: string;
    msgB: string;
    msgC: string;
  } | null {
    switch (view.status) {
      case 'awaiting_approval': {
        const prev = view.steps[view.currentStep - 1] ?? null;
        if (needsProject) {
          return {
            tone: 'amber',
            msgA: t('row.project.msgA'),
            msgB: t('row.project.msgB'),
            msgC: t('row.project.msgC'),
          };
        }
        return {
          tone: 'amber',
          msgA: prev
            ? t(`row.awaiting.msgAFrom.${prev.feature}`)
            : t('row.awaiting.msgAStart'),
          msgB: current ? stepLabel(current.feature) : '',
          msgC: t('row.awaiting.msgC'),
        };
      }
      case 'paused_insufficient_credits': {
        const needed = current?.cost ?? 0;
        const stepName = current ? stepLabel(current.feature) : '';
        return {
          tone: 'amber',
          // 잔액 구절은 creditBalance 가 있을 때만(WRITER-ANSWERS §2 — 없으면
          // 구절만 빠지고 레이아웃은 성립).
          msgA:
            typeof view.creditBalance === 'number'
              ? t('row.paused.msgAWithBalance', {
                  balance: view.creditBalance,
                  step: stepName,
                })
              : t('row.paused.msgA', { step: stepName }),
          msgB: t('cost', { cost: needed }),
          msgC: t('row.paused.msgC'),
        };
      }
      case 'error': {
        const failed = view.steps[view.currentStep] ?? null;
        return {
          tone: 'error',
          msgA: failed
            ? t(`row.error.msgAFrom.${failed.feature}`)
            : t('row.error.msgAFromUnknown'),
          // 사유는 steps[i].error 를 그대로 쓴다(B6 note). "크레딧 미차감" 문장은
          // 계약상 참이 아니라 삭제됨(WRITER-ANSWERS §3).
          msgB: failed?.error ?? t('row.error.reasonUnknown'),
          msgC: t('row.error.msgC'),
        };
      }
      case 'done': {
        const last = view.steps[total - 1] ?? null;
        return {
          tone: 'success',
          msgA: '',
          msgB: last
            ? t('row.done.msgB', { step: stepLabel(last.feature) })
            : t('row.done.msgBGeneric'),
          msgC: t('row.done.msgC'),
        };
      }
      case 'cancelled': {
        const last = lastDoneStep(view);
        return {
          tone: 'neutral',
          msgA: t('row.cancelled.msgA'),
          msgB: last
            ? t('row.cancelled.msgB', { step: stepLabel(last.feature) })
            : t('row.cancelled.msgBGeneric'),
          msgC: t('row.cancelled.msgC'),
        };
      }
      default:
        // running — 아래 행 없음(한 줄 바). 사용자가 할 일이 없을 때는 조용하다.
        return null;
    }
  }

  const isAuto = view.mode === 'auto';

  return (
    <section
      aria-label={t('label')}
      // data-chain-* = conformance 오라클(규칙 2d) 훅. 픽셀 diff·상태 도달 검증이
      // 클래스 문자열에 의존하지 않게 상태를 DOM 에 명시한다(스타일 영향 0).
      data-chain="bar"
      data-chain-status={view.status}
      data-chain-mode={view.mode}
      className="max-w-full overflow-hidden rounded-panel border-2 border-ink bg-paper shadow-popover"
      style={{ width: BAR_WIDTH }}
    >
      {/* 상단 행 — 타일 · 체인+모드 · 구분선 · 트랙 · 상태 텍스트 (§1.1) */}
      <div className="flex items-center gap-[14px] px-4 py-[11px]">
        {/* 체인 타일 — approve = paper/ink 스트로크 · auto = ink 채움/흰 스트로크 */}
        <div
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-icon border-[1.5px] border-ink ${
            isAuto ? 'bg-ink' : 'bg-paper'
          }`}
        >
          <DuotoneIcon name="link" size={17} mono={isAuto} />
        </div>
        <div className="flex shrink-0 flex-col gap-[3px]">
          <span className="text-lg font-extrabold text-ink">{t('label')}</span>
          <span
            className={`inline-flex items-center rounded-pill border-[1.5px] border-ink px-[7px] text-xs font-extrabold ${
              isAuto ? 'bg-ink text-paper' : 'bg-paper text-ink'
            }`}
          >
            {t(isAuto ? 'mode.auto' : 'mode.approve')}
          </span>
        </div>
        <span
          aria-hidden
          className="h-[30px] w-[1.5px] shrink-0 bg-ink/[0.12]"
        />
        {/* 트랙 — steps[] 1:1. 연결선은 앞 노드가 done/skipped 면 실선(체인이
            끊긴 게 아니라 그 단계만 비웠으므로 — B7 note). */}
        <div className="flex min-w-0 flex-1 items-start">
          {view.steps.map((step, i) => {
            // 연결선은 **앞 노드**의 상태가 결정한다 — done/skipped 면 실선.
            const linked =
              step.status === 'done' || step.status === 'skipped';
            return (
              <div
                key={`${step.feature}-${i}`}
                className="flex min-w-0 flex-1 items-start"
              >
                <ChainNode
                  step={step}
                  label={stepLabel(step.feature)}
                  costLabel={costLabel(step.cost)}
                />
                {i < total - 1 && (
                  <div
                    aria-hidden
                    className="mt-[14px] h-0 min-w-[16px] flex-1"
                    style={{
                      borderTop: linked
                        ? '2px solid var(--color-ink)'
                        : '2px dashed var(--color-line-empty)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div
          role="status"
          data-chain-el="status"
          className={`shrink-0 text-right font-mono text-sm font-extrabold ${STATUS_TONE_CLASS[statusTone]}`}
        >
          {statusText}
        </div>
      </div>

      {/* 아래 행 — 조건부. 없는 상태(running)가 기본이고 그때 바는 한 줄이다. */}
      {row && (
        <div
          data-chain-el="row"
          data-chain-row-tone={row.tone}
          className={`flex flex-wrap items-center gap-3 border-t-[1.5px] px-4 py-[11px] ${ROW_TONE_CLASS[row.tone]}`}
        >
          <div className="min-w-[300px] flex-1 text-lg leading-[1.55] text-ink-2">
            {row.msgA}
            <b className="text-ink">{row.msgB}</b>
            {row.msgC}
          </div>

          {needsProject && (
            <ProjectPicker
              projects={projects}
              pickedProjectId={pickedProjectId}
              onPickProject={onPickProject}
              onCreateProject={onCreateProject}
            />
          )}

          {/* 체인 종료 = 텍스트. 비가역이지만 데이터를 지우지 않으므로 붉은
              채움 대상이 아니다(SSOT §D1 · B2 note). */}
          {(view.status === 'awaiting_approval' ||
            view.status === 'paused_insufficient_credits') && (
            // eslint-disable-next-line react/forbid-elements -- CD B2 note: "체인 종료" 는 패딩·보더·밑줄 없는 bare 텍스트 액션(12.5/700 mute)이다. Button variant="link" 는 size padding + hover 밑줄 decoration 을 강제하고, className 으로 되돌리면 §7.11(컴파일 CSS 소스 순서) 때문에 primitive BASE 가 이길 수 있다. fullview-header 의 CD 전용 chrome 선례와 동일.
            <button
              type="button"
              data-chain-action="cancel"
              onClick={onCancel}
              disabled={busy}
              className="shrink-0 text-md font-bold text-mute transition-colors hover:text-ink disabled:opacity-40"
            >
              {t('action.cancel')}
            </button>
          )}

          {/* 보조 버튼 — paper pill. B3 에서는 건너뛰기를 숨긴다(프로젝트 없이
              건너뛰면 다음 단계도 불가 — B3 note). */}
          {view.status === 'awaiting_approval' && !needsProject && (
            <SecondaryPill onClick={() => onSkip(view.currentStep)} busy={busy}>
              {t('action.skip')}
            </SecondaryPill>
          )}
          {view.status === 'paused_insufficient_credits' && (
            <SecondaryPill onClick={onResume} busy={busy}>
              {t('action.resume')}
            </SecondaryPill>
          )}
          {(view.status === 'error' ||
            view.status === 'done' ||
            view.status === 'cancelled') && (
            <SecondaryPill onClick={onDismiss}>
              {t('action.close')}
            </SecondaryPill>
          )}

          {/* 주 버튼 — 진행 버튼에 다음 비용을 붙여 "누르면 돈이 나간다" 를
              버튼 자체가 말하게 한다(B2 note). cost 0 이면 금액 없이 "진행 →". */}
          {view.status === 'awaiting_approval' && (
            <PrimaryPill
              onClick={() => onApprove(view.currentStep)}
              // B3: 프로젝트 선택 전 잠김(SSOT §D1 잠김 형태).
              locked={needsProject && !projectResolved}
              busy={busy}
            >
              {current && current.cost > 0
                ? t('action.proceedCost', { cost: current.cost })
                : t('action.proceed')}
            </PrimaryPill>
          )}
          {view.status === 'paused_insufficient_credits' && (
            <PrimaryPill onClick={onTopUp}>{t('action.topUp')}</PrimaryPill>
          )}
          {view.status === 'error' && current && (
            <PrimaryPill
              onClick={() => onOpen(CHAIN_STEP_WIDGET_KEY[current.feature])}
            >
              {t('action.openWidget', {
                widget: t(`widget.${CHAIN_STEP_WIDGET_KEY[current.feature]}`),
              })}
            </PrimaryPill>
          )}
          {view.status === 'done' && (
            <PrimaryPill
              onClick={() =>
                onOpen(
                  CHAIN_STEP_WIDGET_KEY[
                    view.steps[total - 1]?.feature ?? 'topline'
                  ],
                )
              }
            >
              {t('action.openReport')}
            </PrimaryPill>
          )}
        </div>
      )}
    </section>
  );
}

// ── 행 버튼 (CD 절대값 — SSOT §D1 pill 문법) ───────────────────────────────

function SecondaryPill({
  onClick,
  busy,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §1.1 아래 행 보조 pill 은 border 1.5 ink · radius-pill · shadow 2px2px0 ink/12 전용 chrome. Button variant="secondary" 는 border-2.5 · rounded-sm · shadow-memphis-md 고정이라 형태가 다르고, className override 는 §7.11 소스 순서 때문에 불확정. CD 가 DS 기본값 상위 권위(규칙 2c AUTHORITY).
    <button
      type="button"
      data-chain-action="secondary"
      onClick={onClick}
      disabled={busy}
      className="inline-flex shrink-0 items-center rounded-pill border-[1.5px] border-ink bg-paper px-4 py-2 text-md font-bold text-ink shadow-memphis-sm-faint transition-colors hover:bg-paper-soft disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PrimaryPill({
  onClick,
  locked,
  busy,
  children,
}: {
  onClick: () => void;
  locked?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  // 잠김 = 선택 전(B3). disabled 의 opacity 로 흐리는 대신 명시적 중립 회색
  // (surface-disabled + faint + 그림자 없음) — SSOT §D1 잠김 형태.
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §1.1 주 버튼은 border 2 ink · radius-pill · shadow 2px2px0 ink/28(shadow-memphis-sm-mid) 전용 chrome + "잠김" 상태(surface-disabled·faint·그림자 없음, SSOT §D1)를 가진다. Button primitive 에 없는 형태·상태라 native. 보조 pill 과 동일 선례.
    <button
      type="button"
      data-chain-action="primary"
      data-chain-locked={locked ? 'true' : 'false'}
      onClick={onClick}
      disabled={locked || busy}
      className={
        locked
          ? 'inline-flex shrink-0 items-center gap-1.5 rounded-pill border-2 border-ink/[0.2] bg-surface-disabled px-[18px] py-2 text-lg font-extrabold text-faint'
          : 'inline-flex shrink-0 items-center gap-1.5 rounded-pill border-2 border-ink bg-ink px-[18px] py-2 text-lg font-extrabold text-paper shadow-memphis-sm-mid disabled:opacity-40'
      }
    >
      {children}
    </button>
  );
}

// ── B3 프로젝트 피커 ───────────────────────────────────────────────────────
//
// §2-5 의 프로젝트 선택을 승인 행 안에 합친다 — 별도 스텝·모달을 만들지 않는다.
// 트리거/패널은 Picker 시스템 primitive(SSOT §D3) 재사용: 패널은 body 로 portal
// 되고 z-overlay 라 z-modal 인 바 위로 뜬다(done-when "Picker 패널이 바 위로").
function ProjectPicker({
  projects,
  pickedProjectId,
  onPickProject,
  onCreateProject,
}: {
  projects: ChainBarProject[];
  pickedProjectId: string | null;
  onPickProject?: (projectId: string) => void;
  onCreateProject?: () => void;
}) {
  const t = useTranslations('Chain');
  const [open, setOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const { triggerRef, panelRef, anchorRect } = usePopoverBase<
    HTMLDivElement,
    HTMLDivElement
  >({ open, onClose: () => setOpen(false) });

  const picked = projects.find((p) => p.id === pickedProjectId) ?? null;
  // 패널 첫 항목은 "+ 새 프로젝트" (B3 note) — 기존 생성 경로를 연다.
  const options = [
    { value: '__new', label: t('picker.newProject') },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div ref={triggerRef} data-chain-el="picker" className="shrink-0">
      <PickerTrigger
        ref={triggerButtonRef}
        open={open}
        onClick={() => setOpen((v) => !v)}
        className="w-[230px] justify-between"
      >
        {picked?.name ?? t('picker.placeholder')}
      </PickerTrigger>
      {open && anchorRect && (
        <SingleSelectPanel
          panelRef={panelRef}
          anchorRect={anchorRect}
          width={260}
          sectionLabel={t('picker.sectionLabel')}
          options={options}
          value={pickedProjectId ?? ''}
          onSelect={(value) => {
            setOpen(false);
            if (value === '__new') onCreateProject?.();
            else onPickProject?.(value);
          }}
          onClose={() => setOpen(false)}
          returnFocusRef={triggerButtonRef}
        />
      )}
    </div>
  );
}
