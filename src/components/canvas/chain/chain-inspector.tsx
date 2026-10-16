'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainInspector — 오른쪽 **400 밀어내기 패널** (fresh 프레젠테이션 + 컨테이너).

   비주얼 SSOT = `chain-inspector-scenes.dc.html` I2 · I3 · I3b · I4a · I4b.
   치수·동작 SSOT = `design-handoff/chain-inspector/README.md` §4 · §5 · §6.

   ── 밀어내기 (오버레이 0 — §4.1) ────────────────────────────────────────
   이 패널은 `[data-canvas]` 의 **형제**다(팔레트와 같은 층). flex 형제라
   열리면 캔버스 뷰포트가 그만큼 좁아진다 — 레인의 캔버스 좌표는 그대로이고
   보이는 창만 줄어든다. 캔버스 transform **밖**이라 `[data-canvas-body]`
   cascade 도 닿지 않는다(CD §9 · LEARNINGS §5).

   ── 모달이 아니다 ──────────────────────────────────────────────────────
   `role="complementary"` + Esc 닫기 + 포커스 복귀만 있고 **포커스 트랩이
   없다**(§4.7). 트랩을 걸면 레인·팔레트가 키보드로 닿지 않게 되는데, 이 패널은
   화면을 점유하는 표면이 아니라 나란히 있는 표면이다.

   ── 결과 탭을 두지 않는다 (§7 · Q6) ────────────────────────────────────
   완료 단계에서도 설정을 읽기 전용으로 보여주고 하단 버튼만 "결과 보기 ↗" 로
   바뀐다. 결과는 **기존 풀뷰**가 유일한 거처다 — 400 폭에 보고서를 담으면
   풀뷰와 이중 표면이 된다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { CloseButton } from '@/components/ui/close-button';
import { widgetIconFor } from '@/components/canvas/shell/widget-icon';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useWidgetStateOf } from '@/components/canvas/shell/widget-state-context';
import {
  cardBadgeOf,
  derivedValuesOf,
  evaluableRequiredFields,
  formatFieldValue,
  isChainActive,
  isStepConfigWritable,
  requiredProgressOf,
  stepContextOf,
  type ChainCardSignal,
} from '@/lib/chains/card-state';
import { stepUiMeta } from '@/lib/chains/ui-meta';
import {
  CHAIN_STEP_NAME_KEY,
  CHAIN_STEP_TONE,
  CHAIN_STEP_WIDGET_KEY,
  type ChainStepView,
} from '@/lib/chains/view';
import { useWidgetChain } from './widget-chain-provider';
import { useChainInspector } from './chain-inspector-provider';
import {
  ChainInspectorField,
  type ChainReadonlyRow,
} from './chain-inspector-fields';

/** CD §6 — ≥1024 는 400, 900–1023 은 360. <900 은 범위 밖(모바일 시트). */
export const INSPECTOR_W = 400;
export const INSPECTOR_W_NARROW = 360;
/** 인스펙터가 좁아지는 경계(§6 표의 1024). */
const NARROW_VW = 1024;
/** 체인이 없을 때의 안정 참조 — 매 렌더 새 배열을 만들지 않는다. */
const EMPTY_STEPS: readonly ChainStepView[] = [];

const SIGNAL: Record<ChainCardSignal, { bg: string; fg: string; dot: string }> = {
  ok: { bg: 'bg-soft-ok-bg', fg: 'text-soft-ok-fg', dot: 'bg-soft-ok-dot' },
  run: { bg: 'bg-soft-run-bg', fg: 'text-soft-run-fg', dot: 'bg-soft-run-dot' },
  warn: { bg: 'bg-soft-warn-bg', fg: 'text-soft-warn-fg', dot: 'bg-soft-warn-dot' },
  err: { bg: 'bg-soft-err-bg', fg: 'text-soft-err-fg', dot: 'bg-soft-err-dot' },
  idle: { bg: 'bg-soft-fill', fg: 'text-soft-ink-2', dot: 'bg-soft-faint' },
};

const TONE_BG: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

/** 인스펙터 폭 — 뷰포트 기준(팔레트 접힘과 같은 resize 패턴). */
export function useInspectorWidth(): number {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const sync = () => setNarrow(window.innerWidth < NARROW_VW);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return narrow ? INSPECTOR_W_NARROW : INSPECTOR_W;
}

export type ChainInspectorProps = {
  /** "진행 보기 ↗" / "결과 보기 ↗" → 기존 풀뷰. */
  onOpenFullview: (widgetKey: string) => void;
  width: number;
};

export function ChainInspector({ onOpenFullview, width }: ChainInspectorProps) {
  const t = useTranslations();
  const { view } = useWidgetChain();
  const { selectedIndex, close, go, configAt, setField, saveState, retry } =
    useChainInspector();
  const { projects } = useInterviewV2Projects();
  const panelRef = useRef<HTMLElement | null>(null);

  // `view?.steps ?? []` 를 그대로 쓰면 체인이 없을 때 매 렌더 새 배열이 되어
  // 아래 useMemo 들의 의존성이 항상 바뀐다(react-hooks/exhaustive-deps).
  const steps = useMemo(() => view?.steps ?? EMPTY_STEPS, [view?.steps]);
  const index = selectedIndex;
  const step = index === null ? null : (steps[index] ?? null);
  const feature = step?.feature ?? null;
  const widgetKey = feature ? CHAIN_STEP_WIDGET_KEY[feature] : null;

  // ── Esc 닫기 (§4.7). 모달이 아니라 window 리스너 하나로 끝낸다. ──────
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, close]);

  // ── 포커스: 열리면 첫 편집 필드, 닫히면 원래 카드 (§4.7) ─────────────
  // 복귀 대상을 `document.activeElement` 로 잡지 않는 이유: 열림 경로가 카드
  // 클릭·"설정하기" 버튼·‹ › 이동 세 가지라 그때그때 다른 요소가 잡힌다.
  // 레인 안 카드 노드를 **선택자로** 되찾는 쪽이 경로와 무관하게 맞다.
  const lastWidgetRef = useRef<string | null>(null);
  useEffect(() => {
    if (widgetKey) lastWidgetRef.current = widgetKey;
    if (index === null) {
      const key = lastWidgetRef.current;
      if (!key) return;
      const card = document.querySelector<HTMLElement>(
        `[data-chain-card-step="${key}"]`,
      );
      card?.focus();
      return;
    }
    const first = panelRef.current?.querySelector<HTMLElement>(
      '[data-chain-field] select:not([disabled]), [data-chain-field] textarea:not([disabled]), [data-chain-field] input:not([disabled]), [data-chain-field] button:not([disabled])',
    );
    first?.focus();
  }, [index, widgetKey]);

  // 위젯 상태 채널 — 실행 중 진척/현재 작업(상태 줄의 "남은 시간" 자리).
  const widgetState = useWidgetStateOf(widgetKey ?? '');

  // projectId 를 먼저 꺼내 두는 이유: deps 를 `view?.projectId` 로 두면 React
  // Compiler 가 추론한 의존성(`view`)과 어긋나 수동 메모이제이션을 보존하지
  // 못한다(react-hooks/preserve-manual-memoization). 값으로 좁혀 두면 추론과
  // 선언이 같아진다.
  const projectId = view?.projectId ?? null;
  const projectDocumentCount = useMemo(() => {
    if (!projectId) return null;
    const p = projects.find((x) => x.id === projectId);
    return p ? p.document_count : null;
  }, [projectId, projects]);

  const ctx = useMemo(
    () => (index === null ? null : stepContextOf(steps, index)),
    [steps, index],
  );
  // 낙관적 반영이 얹힌 설정으로 **덮어쓴** 맥락 — 카드와 같은 값을 본다.
  const liveCtx = useMemo(
    () => (ctx && index !== null ? { ...ctx, config: configAt(index) } : null),
    [ctx, index, configAt],
  );

  const derived = useMemo(
    () =>
      liveCtx ? derivedValuesOf({ ctx: liveCtx, projectDocumentCount }) : null,
    [liveCtx, projectDocumentCount],
  );

  const onFieldChange = useCallback(
    (fieldId: string, value: unknown) => {
      if (index === null) return;
      setField(index, fieldId, value);
    },
    [index, setField],
  );

  const meta = feature ? stepUiMeta(feature) : null;
  if (
    index === null ||
    !step ||
    !feature ||
    !widgetKey ||
    !liveCtx ||
    !derived ||
    // 레지스트리에 선언이 없는 단계는 그릴 근거가 없다 — 추측하지 않는다
    // (라우트도 같은 경우를 `unknown_step` 으로 거절한다).
    !meta
  ) {
    return null;
  }

  const tone = CHAIN_STEP_TONE[feature];
  const name = t(`Chain.${CHAIN_STEP_NAME_KEY[feature]}`);
  const chainActive = isChainActive(view?.status ?? '');
  const locked = !isStepConfigWritable(liveCtx, chainActive);
  const badge = cardBadgeOf(liveCtx);
  const sig = SIGNAL[badge.tone];
  const progress = requiredProgressOf(liveCtx);
  const requiredIds = new Set(evaluableRequiredFields(liveCtx).map((f) => f.id));
  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const runPct =
    widgetState.kind === 'running' && typeof widgetState.progress === 'number'
      ? Math.round(widgetState.progress)
      : null;

  // 상태 줄 오른쪽 mono — 실행 중이면 진척, 그 외에는 비용.
  const statusRight =
    step.status === 'running' && runPct !== null
      ? t('Chain.card.progressPercent', { pct: runPct })
      : step.cost > 0
        ? t('Chain.card.costEstimate', { cost: step.cost })
        : t('Chain.costIncluded');

  // 섹션 묶음 — 선언 순서를 그대로 유지한다(ui-meta 가 SSOT).
  const sections: { key: string; fields: typeof meta.inspectorSchema }[] = [];
  for (const field of meta.inspectorSchema) {
    const last = sections[sections.length - 1];
    if (last && last.key === field.section) {
      last.fields = [...last.fields, field];
    } else {
      sections.push({ key: field.section, fields: [field] });
    }
  }

  const readonlyRowFor = (fieldId: string): ChainReadonlyRow | undefined => {
    const field = meta.inspectorSchema.find((f) => f.id === fieldId);
    // 읽기 전용 행을 그리는 kind 에만 만든다 — 모든 필드에 만들면 존재하지
    // 않는 `inspector.sub.*` 키를 조회해 next-intl 이 누락 에러를 뱉는다.
    if (!field || (field.kind !== 'readonly' && field.kind !== 'dropzone')) {
      return undefined;
    }
    const value = formatFieldValue(liveCtx, field, t, derived);
    const fromChain = field.source === 'chain';
    return {
      value: value ?? t('Chain.inspector.valueUnknown'),
      sub: t(`Chain.inspector.sub.${feature}.${fieldId}`, {
        upstream: derived.upstreamStepNumber ?? 0,
      }),
      chip: t(fromChain ? 'Chain.inspector.chip.chain' : 'Chain.inspector.chip.upstream'),
      tone: fromChain
        ? null
        : liveCtx.upstream
          ? CHAIN_STEP_TONE[liveCtx.upstream]
          : null,
    };
  };

  return (
    <aside
      ref={panelRef}
      data-chain="inspector"
      data-chain-inspector-step={widgetKey}
      data-chain-inspector-locked={locked ? 'true' : 'false'}
      role="complementary"
      aria-label={t('Chain.inspector.ariaLabel', {
        chain: t('Chain.lane.title'),
        n: index + 1,
      })}
      style={{ width }}
      className="flex h-full shrink-0 flex-col border-l border-soft-hair bg-soft-surface"
    >
      {/* 헤더 64 */}
      <header className="flex h-16 shrink-0 items-center gap-[11px] border-b border-soft-hair pr-3.5 pl-5">
        <span
          aria-hidden
          style={{ width: 32, height: 32 }}
          className={`flex shrink-0 items-center justify-center rounded-icon ${TONE_BG[tone]}`}
        >
          <DuotoneIcon name={widgetIconFor(widgetKey)} size={17} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="font-soft-mono text-xs-soft text-soft-faint">
            {t('Chain.inspector.eyebrow', {
              chain: t('Chain.lane.title'),
              n: index + 1,
              total: steps.length,
            })}
          </span>
          <span className="truncate text-xl font-bold text-ink">{name}</span>
        </span>
        <NavCircle
          glyph="‹"
          label={t('Chain.inspector.prev')}
          disabled={isFirst}
          onClick={() => go(-1)}
        />
        <NavCircle
          glyph="›"
          label={t('Chain.inspector.next')}
          disabled={isLast}
          onClick={() => go(1)}
        />
        <CloseButton
          variant="dialog-close"
          aria-label={t('Chain.action.close')}
          onClick={close}
        />
      </header>

      {/* 상태 줄 */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-soft-hair px-5 py-2.5">
        <span
          className={`inline-flex items-center gap-[5px] rounded-pill px-[9px] py-0.5 text-sm font-semibold whitespace-nowrap ${sig.bg} ${sig.fg}`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${sig.dot} ${
              badge.pulse ? 'animate-sipulse' : ''
            }`}
          />
          {t(badge.labelKey)}
        </span>
        <span className="font-soft-mono text-sm whitespace-nowrap text-soft-mute">
          {statusRight}
        </span>
      </div>

      {/* 본문 — 섹션 간격 26 · 세로 스크롤 */}
      <div
        data-chain-el="inspector-body"
        className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto p-5"
      >
        {locked && (
          // 안내 박스 — 실행 중 잠금(§5). 160ms 페이드인은 기존 모션 유틸을
          // 재사용한다(새 keyframe 0). reduced-motion 은 그 유틸이 존중한다.
          <div
            data-chain-el="lock-note"
            aria-live="polite"
            className="palette-fade-in shrink-0 rounded-control bg-soft-run-bg px-[13px] py-[11px] text-md leading-[1.6] text-soft-run-fg"
          >
            {t(
              chainActive
                ? 'Chain.inspector.lockedRunning'
                : 'Chain.inspector.lockedEnded',
            )}
          </div>
        )}

        {/* 체인 공통 값(프로젝트) — 단계 설정이 아니라 체인 설정이다(§0 구멍 ②).
            맨 위 읽기 전용 행으로만 보여주고 변경은 레인 헤더 경로를 쓴다. */}
        {view?.projectId && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <span className="text-md font-semibold text-soft-ink-2">
              {t('Chain.inspector.projectLabel')}
            </span>
            <ProjectRow
              name={
                projects.find((p) => p.id === view.projectId)?.name ??
                t('Chain.inspector.valueUnknown')
              }
              sub={t('Chain.inspector.projectSub')}
              chip={t('Chain.inspector.chip.chain')}
            />
          </div>
        )}

        {sections.map((section) => (
          <section key={section.key} className="flex shrink-0 flex-col gap-3.5">
            <span className="text-lg font-bold text-ink">{t(section.key)}</span>
            {section.fields.map((field) => (
              <ChainInspectorField
                key={field.id}
                field={field}
                value={liveCtx.config[field.id]}
                required={requiredIds.has(field.id)}
                locked={locked}
                t={t}
                onChange={(value) => onFieldChange(field.id, value)}
                readonlyRow={readonlyRowFor(field.id)}
              />
            ))}
          </section>
        ))}
      </div>

      {/* 하단 — 필수 진행도 + 주/보조 버튼 (§4.6 · §5) */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-soft-hair px-5 py-3.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          {locked ? (
            <span className="inline-flex items-center gap-1.5 text-md font-semibold text-soft-run-fg">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-soft-run-dot" />
              {t('Chain.inspector.lockedFoot')}
            </span>
          ) : progress.total === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-md font-semibold text-soft-ok-fg">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-soft-ok-dot" />
              {t('Chain.inspector.noSettings')}
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 text-md font-semibold ${
                progress.missing.length > 0
                  ? 'text-soft-warn-fg'
                  : 'text-soft-ok-fg'
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  progress.missing.length > 0
                    ? 'bg-soft-warn-dot'
                    : 'bg-soft-ok-dot'
                }`}
              />
              {progress.missing.length > 0
                ? t('Chain.inspector.requiredProgress', {
                    filled: progress.filled,
                    total: progress.total,
                  })
                : t('Chain.inspector.requiredDone', { total: progress.total })}
            </span>
          )}
          <SaveStamp state={saveState} locked={locked} onRetry={retry} t={t} />
        </span>
        <span className="flex-1" />
        {locked ? (
          <FooterButton
            tone="secondary"
            label={t(
              step.status === 'running'
                ? 'Chain.inspector.openProgress'
                : 'Chain.card.action.openResult',
            )}
            onClick={() => onOpenFullview(widgetKey)}
          />
        ) : isLast ? (
          <FooterButton
            tone="secondary"
            label={t('Chain.action.close')}
            onClick={close}
          />
        ) : (
          <FooterButton
            tone="primary"
            label={t('Chain.inspector.nextStep')}
            onClick={() => go(1)}
          />
        )}
      </footer>
    </aside>
  );
}

// ── 조각 ────────────────────────────────────────────────────────────────

function NavCircle({
  glyph,
  label,
  disabled,
  onClick,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §4.2 의 ‹ › 는 **30px** 원형 + 1px --line 이다. IconButton 의 size 는 24/28/32 뿐이라 30 이 없고, className 으로 h/w 를 덮는 것은 §7.11(컴파일 CSS 소스 순서)에서 불확정이다. 공유 primitive 에 size 를 추가하는 것은 전 앱 영향이라 별 PR — 가까운 28/32 로 굽히지 않는다(AUTHORITY).
    <button
      type="button"
      data-chain-action="inspector-nav"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: 30, height: 30 }}
      className={`flex shrink-0 items-center justify-center rounded-full border border-soft-line text-lg transition-colors focus:outline-none focus-visible:shadow-soft-focus-ring ${
        disabled
          ? 'cursor-not-allowed text-soft-disabled'
          : 'text-ink hover:border-soft-line-hover hover:bg-soft-surface-2'
      }`}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

function FooterButton({
  tone,
  label,
  onClick,
}: {
  tone: 'primary' | 'secondary';
  label: string;
  onClick: () => void;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §4.6 하단 버튼은 높이 36 · px 16 · 13/600 · pill 이다. Button primitive 의 size 는 패딩 파생 높이라 36 이 안 나오고 className 되돌리기는 §7.11 로 불확정 — 카드 "설정하기"·캡슐 주/보조 버튼과 같은 선례.
    <button
      type="button"
      data-chain-action="inspector-footer"
      onClick={onClick}
      style={{ height: 36 }}
      className={`inline-flex shrink-0 items-center rounded-pill px-4 text-lg font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:shadow-soft-focus-ring ${
        tone === 'primary'
          ? 'bg-ink text-soft-surface hover:bg-soft-ink-hover'
          : 'border border-soft-line bg-soft-surface text-ink hover:bg-soft-surface-2'
      }`}
    >
      {label}
    </button>
  );
}

function SaveStamp({
  state,
  locked,
  onRetry,
  t,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  locked: boolean;
  onRetry: () => void;
  t: (key: string) => string;
}) {
  if (locked) return null;
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-soft-mono text-xs-soft text-soft-err-fg">
          {t('Chain.inspector.saveFailed')}
        </span>
        {/* eslint-disable-next-line react/forbid-elements -- CD §4.5 "재시도 버튼 하나" 는 진행도 자리에 들어가는 bare 텍스트다(패딩·보더 0). Button variant="link" 는 size padding + hover 밑줄을 강제한다(§7.11 로 되돌리기 불확정). */}
        <button
          type="button"
          data-chain-action="save-retry"
          onClick={onRetry}
          className="font-soft-mono text-xs-soft font-bold text-ink underline decoration-1 underline-offset-2"
        >
          {t('Chain.inspector.retry')}
        </button>
      </span>
    );
  }
  if (state === 'idle') return null;
  return (
    <span className="font-soft-mono text-xs-soft text-soft-faint">
      {t(state === 'saving' ? 'Chain.inspector.saving' : 'Chain.inspector.saved')}
    </span>
  );
}

function ProjectRow({
  name,
  sub,
  chip,
}: {
  name: string;
  sub: string;
  chip: string;
}) {
  return (
    <div
      data-chain-el="readonly-row"
      className="flex items-center gap-2.5 rounded-control border border-soft-hair bg-soft-surface-2 px-3 py-2.5"
    >
      <span
        aria-hidden
        style={{ width: 26, height: 26 }}
        className="flex shrink-0 items-center justify-center rounded-tile bg-soft-fill"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-md font-semibold text-ink">{name}</span>
        <span className="text-sm text-soft-mute">{sub}</span>
      </span>
      <span className="shrink-0 rounded-pill bg-soft-fill px-2 py-0.5 text-xs-soft font-semibold whitespace-nowrap text-soft-mute">
        {chip}
      </span>
    </div>
  );
}
