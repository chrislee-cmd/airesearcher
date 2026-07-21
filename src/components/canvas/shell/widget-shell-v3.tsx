'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShellV3 — 통합 SSOT(#1114) WIDGET-SHELL "Frame spec" 셸.

   AUTHORITY §D (fresh 신규 빌드): 옛 production 셸(140px 노란 밴드 + 32px
   타이틀 = README 상 DEPRECATED frame)을 편집하지 않고, CD `.dc.html` /
   README Frame spec 대로 새 셸을 짓는다. 6 greenfield v3 위젯(Desk·
   recruiting…)이 공유 — 위젯별 차이는 헤더 파스텔(accent)+credit+body 뿐.

   Frame spec (README, 전용 토큰 — DS 기본으로 폴백 금지):
   - 카드: border 3px ink · radius `--radius-widget-card`(20) · bg paper ·
     shadow `--shadow-widget-card`(4px4px0 ink) · overflow hidden · flex col
   - 헤더: accent 파스텔 bg(`--widget-header-bg-<accent>`, cyan=Desk) ·
     border-bottom 2px ink · padding 18/22 · 타이틀 Outfit 800/29/-0.9 ·
     우측 단일 툴바 pill
   - 툴바 pill: [💎credit │ ●STATUS │ 🎨 팔레트 │ ⤢ 확장] — 1.5px ink 보더 +
     radius 10 + shadow `--shadow-widget-pill`(2px2px0 ink), 세그먼트 사이
     1.5px ink 디바이더
   - body: `data-canvas-body` 로 감싸 기존 canvas typography cascade 유지.
     footer(footNote+CTA)는 body 소유 — CTA 액션이 body 폼 상태에 결합돼
     있어 body 가 렌더(README footer 를 body 최하단 바로 재현). 보수적 해석.

   재사용 배선: WidgetStateProvider(상태 pill) · useWidgetHeaderColor(팔레트) ·
   useCreditDeductionEvent(차감 fly-up) · WidgetGateOverlay · onFullview.
   raw hex/px(색·radius·shadow) 0 — 전부 토큰 var(). 순수 geometry(패딩/보더폭/
   폰트크기)만 px 리터럴(check:design 비대상 속성).
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { resolveWidgetLabel, type WidgetContent } from '../widget-types';
import {
  WidgetHeaderColorPicker,
  useWidgetHeaderColor,
} from './widget-header-color';
import {
  WidgetStateProvider,
  useWidgetState,
} from './widget-state-context';
import { widgetStatePillLabel } from './widget-state-pill';
import { IconButton } from '@/components/ui/icon-button';
import {
  useCreditDeductionEvent,
  type CreditDeductionEvent,
} from '@/components/credit-deduction-provider';
import { WidgetGateOverlay } from '@/components/widget-gate-overlay';
import type { FeatureKey } from '@/lib/features';

export type DragHandleProps = {
  draggable: boolean;
  onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLElement>) => void;
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void;
};

// 차감 신호 → 헤더 위쪽으로 -N 텍스트가 떠올라 사라진다 (production 셸의
// CostFlyUpOverlay 와 동일 동작 — creditFlyUp keyframe, tick key remount).
function CostFlyUpOverlay({ featureKey }: { featureKey: string }) {
  const [event, setEvent] = useState<CreditDeductionEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useCreditDeductionEvent((e) => {
    setEvent(e);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setEvent(null), 1800);
  }, featureKey as FeatureKey);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!event) return null;
  return (
    <span
      key={event.tick}
      aria-hidden
      className="pointer-events-none absolute right-5 top-3 text-sm font-bold tabular-nums"
      style={{
        color: 'var(--color-warning)',
        animation: 'creditFlyUp 1.6s ease-out forwards',
        textShadow: '0 1px 0 rgba(255, 255, 255, 0.7)',
      }}
    >
      −{event.amount}
    </span>
  );
}

// 두 대각 화살(확장/전체보기) — README M6 2H2v4… glyph. 장식 + aria-hidden.
function ExpandGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 툴바 pill 세그먼트 세로 디바이더 (1.5px ink).
function Divider() {
  return (
    <span
      aria-hidden
      style={{ width: '1.5px', alignSelf: 'stretch', background: 'var(--color-ink)' }}
    />
  );
}

// 헤더 우측 단일 툴바 pill — credit · status · 팔레트 · 확장 4 세그먼트.
function ToolbarPill({
  content,
  headerColor,
  setHeaderColor,
  onFullview,
}: {
  content: WidgetContent;
  headerColor: string | null;
  setHeaderColor: (c: string | null) => void;
  onFullview?: () => void;
}) {
  const { state } = useWidgetState();
  const t = useTranslations('Shell');
  const tWidgets = useTranslations('Widgets');
  const statusLabel = widgetStatePillLabel(state);
  // status 도트 색 — running(진행)=amore, 그 외(ready/done)=success green,
  // error=warning. README: ● dot 7px.
  const dotColor =
    state.kind === 'running'
      ? 'var(--color-amore)'
      : state.kind === 'error'
        ? 'var(--color-warning)'
        : 'var(--color-success)';
  const creditLabel = content.meta.costLabel
    ? content.meta.costLabel
    : typeof content.meta.cost === 'number' && content.meta.cost > 0
      ? String(content.meta.cost)
      : null;

  return (
    <span
      className="flex shrink-0 items-stretch overflow-hidden"
      style={{
        border: '1.5px solid var(--color-ink)',
        borderRadius: 10,
        background: 'var(--color-paper)',
        boxShadow: 'var(--shadow-widget-pill)',
        fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
      }}
    >
      {/* Seg 1 — credit */}
      {creditLabel && (
        <span
          className="flex items-center gap-1 font-bold tabular-nums"
          style={{ padding: '6px 10px', fontSize: '11px', color: 'var(--color-ink)' }}
          aria-label={
            content.meta.costLabel ?? t('creditCost', { count: content.meta.cost ?? 0 })
          }
        >
          <span aria-hidden>💎</span>
          <span>{creditLabel}</span>
        </span>
      )}
      {creditLabel && <Divider />}
      {/* Seg 2 — status */}
      <span
        className="flex items-center gap-1.5 font-bold uppercase"
        style={{ padding: '6px 10px', fontSize: '10.5px', letterSpacing: '1px', color: 'var(--color-ink)' }}
      >
        <span
          aria-hidden
          className="rounded-full"
          style={{ width: '7px', height: '7px', background: dotColor }}
        />
        <span>{statusLabel}</span>
      </span>
      <Divider />
      {/* Seg 3 — 팔레트 (헤더 색) */}
      <span className="flex items-center" style={{ padding: '2px 8px' }}>
        <WidgetHeaderColorPicker
          value={headerColor}
          onChange={setHeaderColor}
          triggerVariant="plain"
          triggerSize="compact"
        />
      </span>
      {/* Seg 4 — 확장 / 전체 보기 */}
      {onFullview && (
        <>
          <Divider />
          <span className="flex items-center" style={{ padding: '2px 8px' }}>
            <IconButton
              variant="plain"
              size="compact"
              aria-label={tWidgets('fullview')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onFullview();
              }}
            >
              <ExpandGlyph />
            </IconButton>
          </span>
        </>
      )}
    </span>
  );
}

export function WidgetShellV3({
  content,
  dragHandleProps,
  onFullview,
}: {
  content: WidgetContent;
  // 호출부 의도 표식 (production 셸과 동일 시그니처).
  dashboardMode?: boolean;
  dragHandleProps?: DragHandleProps;
  onFullview?: () => void;
}) {
  return (
    <WidgetStateProvider widgetKey={content.key} initialState={{ kind: content.state }}>
      <WidgetShellV3Inner
        content={content}
        dragHandleProps={dragHandleProps}
        onFullview={onFullview}
      />
    </WidgetStateProvider>
  );
}

function WidgetShellV3Inner({
  content,
  dragHandleProps,
  onFullview,
}: {
  content: WidgetContent;
  dragHandleProps?: DragHandleProps;
  onFullview?: () => void;
}) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const [headerColor, setHeaderColor] = useWidgetHeaderColor(content.key);
  const tRoot = useTranslations();

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      aria-expanded
      style={{
        background: 'var(--color-paper)',
        border: '3px solid var(--color-ink)',
        borderRadius: 'var(--radius-widget-card)',
        boxShadow: 'var(--shadow-widget-card)',
      }}
    >
      {/* 헤더 밴드 (drag handle) — accent 파스텔. 우선순위: 사용자 per-widget
          색 > accent 파스텔. 행(row) 톤은 v3 에서 무시 — 위젯이 헤더 소유. */}
      <div
        className={`flex shrink-0 items-center justify-between gap-3 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        {...dragHandleProps}
        style={{
          padding: '18px 22px',
          background: headerColor ?? `var(--widget-header-bg-${content.meta.accent})`,
          borderBottom: '2px solid var(--color-ink)',
        }}
      >
        <div
          className="min-w-0 truncate"
          style={{
            fontFamily: 'var(--font-outfit), var(--font-sans)',
            fontSize: '29px',
            fontWeight: 800,
            letterSpacing: '-0.9px',
            lineHeight: 1.05,
            color: 'var(--color-ink)',
          }}
        >
          {resolveWidgetLabel(tRoot, content.meta)}
        </div>
        <ToolbarPill
          content={content}
          headerColor={headerColor}
          setHeaderColor={setHeaderColor}
          onFullview={onFullview}
        />
        <CostFlyUpOverlay featureKey={content.key} />
      </div>

      {/* body — data-canvas-body 로 기존 typography cascade 유지. 스텝 레일 +
          footer(footNote+CTA)는 body(ExpandedBody)가 렌더. */}
      <div data-canvas-body className="min-h-0 flex-1 overflow-hidden">
        <ExpandedBody />
      </div>

      {/* 동시사용 정원 초과 시 이 위젯만 덮는 국소 대기 오버레이. */}
      <WidgetGateOverlay widget={content.key} />
    </div>
  );
}
