'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   pop 잠금 디자인 (PR-D2 재정의) — banner-top + framed + display.
   - 카드 chrome: 흰 bg + 3px 검은 border + 14px radius + 6px offset shadow.
     (canvas pop 토큰 — globals.css @theme).
   - 헤더 (banner-top, 140px): 노랑 bg (canvas-card-header-bg) + 검은 3px bottom border +
     Outfit 폰트. 윗줄에 cost (좌) + state pill (우), 아래에 대형 32px label
     + description.
   - 본문 (framed): 2.5px 검은 inner border + inset shadow 액자 wrapper.
     data-canvas-body 부착 — Memphis bold + display typography scoped
     CSS rule 이 그 안의 button / input / 헤딩에 적용 (globals.css §canvas).
   - 헤더 영역 = drag handle (parent 가 dragHandleProps wire).
   ──────────────────────────────────────────────────────────────────── */

import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { Button } from '@/components/ui/button';
import {
  WidgetHeaderColorPicker,
  useWidgetHeaderColor,
} from './widget-header-color';
import {
  WidgetStateProvider,
  useWidgetState,
} from './widget-state-context';
import { WidgetStatePill } from './widget-state-pill';
import { WidgetCreditBadge } from './widget-credit-badge';
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

// 헤더 우측 상태 pill. WidgetStateContext 에서 현재 위젯 상태를 읽어
// WidgetStatePill primitive 에 넘기는 얇은 래퍼 — 라벨/톤/렌더 로직은
// primitive 가 SSOT (widget-state-pill.tsx). shell ↔ body context 배선은
// 여기서 유지, 카탈로그는 primitive 를 state prop 만 바꿔 standalone 데모.
function PopStatePill() {
  const { state } = useWidgetState();
  return <WidgetStatePill state={state} />;
}

// 차감 신호 받으면 헤더 위쪽으로 -N 텍스트가 떠올라 사라진다.
// CSS keyframe `creditFlyUp` 가 1.6s ease-out forwards — 끝나면 자동 unmount
// 해야 다음 차감 때 다시 재생된다. event.tick 을 React key 로 써서 같은
// 컴포넌트가 강제 remount → animation 재시작.
function CostFlyUpOverlay({ featureKey }: { featureKey: string }) {
  const [event, setEvent] = useState<CreditDeductionEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useCreditDeductionEvent(
    (e) => {
      setEvent(e);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setEvent(null), 1800);
    },
    featureKey as FeatureKey,
  );

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
      className="pointer-events-none absolute right-4 top-3 text-sm font-bold tabular-nums"
      style={{
        color: 'var(--color-warning)',
        animation: 'creditFlyUp 1.6s ease-out forwards',
        textShadow: '0 1px 0 rgba(255,255,255,0.7)',
      }}
    >
      −{event.amount}
    </span>
  );
}

// Inline expand-corners glyph (arrows-out). Explicit size className +
// aria-hidden satisfies the a11y QA rules (the button is labelled via its
// own aria-label / visible text; the SVG itself is decorative + sized).
function FullviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

// Inline right-arrow glyph — "이동" 시그널 (다른 화면으로 진입). Decorative +
// aria-hidden; 버튼은 자체 text/aria-label 로 라벨링됨 (FullviewIcon 과 동일 규칙).
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WidgetShell({
  content,
  dragHandleProps,
  onFullview,
}: {
  content: WidgetContent;
  // 호출부 의도 표식 (현재는 default 동작).
  dashboardMode?: boolean;
  // 부모가 위젯 순서 변경 dnd 를 wire-up. 헤더 영역에 spread.
  dragHandleProps?: DragHandleProps;
  // state pill 하단 "전체 보기" 진입점. 넘기는 위젯이 있을 때만 버튼 노출 —
  // 미전달이면 버튼 0 → 회귀 0 (PR-C 가 위젯별 wire).
  onFullview?: () => void;
}) {
  // shell 헤더 (PopStatePill) ↔ body (job hook) 가 같은 인스턴스 안에서
  // state 를 주고받게 1-위젯-1-Provider 로 wrap. 초기값은 widget meta 의
  // 정적 state — 현재 모든 위젯이 'idle'. body 가 어떤 setState 도 호출
  // 안 하면 초기값 그대로 노출.
  return (
    <WidgetStateProvider widgetKey={content.key} initialState={{ kind: content.state }}>
      <WidgetShellInner
        content={content}
        dragHandleProps={dragHandleProps}
        onFullview={onFullview}
      />
    </WidgetStateProvider>
  );
}

function WidgetShellInner({
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
  const tWidgets = useTranslations('Widgets');
  const tRoot = useTranslations();

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      aria-expanded
      style={{
        background: 'var(--canvas-card-bg)',
        border: 'var(--canvas-card-border-width) solid var(--canvas-card-border)',
        borderRadius: 'var(--canvas-card-radius)',
        boxShadow: 'var(--canvas-card-shadow)',
      }}
    >
      <div
        className={`flex shrink-0 flex-col justify-center gap-1 px-5 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        {...dragHandleProps}
        style={{
          height: 140,
          paddingTop: 16,
          paddingBottom: 16,
          // 우선순위: 사용자 per-widget 색(headerColor) > 행 색(부모 canvas-board
          // 이 --widget-header-row-* 로 주입) > 전역 default(노란 banner).
          background:
            headerColor ??
            'var(--widget-header-row-bg, var(--canvas-card-header-bg))',
          color: 'var(--canvas-card-header-text)',
          fontFamily: 'var(--font-outfit), var(--font-sans)',
          borderBottom:
            '3px solid var(--widget-header-row-border, var(--canvas-card-header-divider))',
        }}
      >
        <div className="relative flex items-center gap-2 text-xs uppercase">
          <WidgetCreditBadge
            cost={content.meta.cost}
            costLabel={content.meta.costLabel}
          />
          {/* 컬러 팔레트는 cost 옆 (좌측 고정) — 우측 pill 이 state 에 따라
              너비가 변해도 (READY → TRANSCRIBING 72%) 팔레트 버튼 위치는
              움직이지 않는다. */}
          <WidgetHeaderColorPicker
            value={headerColor}
            onChange={setHeaderColor}
          />
          {/* 우측 = state pill + "전체 보기" 진입을 한 줄(인라인)로. pill 우측에
              나란히 둬서 첫 row 가 단일 라인 높이로 유지 → 대형 32px 타이틀이
              아래 row 때문에 밀려 윗부분이 잘리던 회귀 해소. onFullview 넘긴
              위젯만 버튼 노출 → 미전달이면 버튼 0 (회귀 0). 노란 헤더 위 link
              톤 text-only 진입점. */}
          <span className="ml-auto flex items-center gap-2">
            <PopStatePill />
            {onFullview && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onFullview}
                aria-label={tWidgets('fullview')}
                leftIcon={<FullviewIcon className="h-3.5 w-3.5" />}
                rightIcon={<ArrowRightIcon className="h-3.5 w-3.5" />}
                className="normal-case tracking-[0.08em] font-semibold"
              >
                {tWidgets('fullview')}
              </Button>
            )}
          </span>
          <CostFlyUpOverlay featureKey={content.key} />
        </div>
        <div
          className="truncate"
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: 'var(--canvas-card-header-text)',
          }}
        >
          {content.meta.labelKey
            ? tRoot(content.meta.labelKey)
            : content.meta.label}
        </div>
      </div>
      {/* framed body — 2.5px 검은 inner frame + inset shadow. 그 안쪽
          wrapper 가 data-canvas-body — globals.css 의 Memphis bold +
          display typography scoped rule 이 button / input / 헤딩에 적용. */}
      <div
        className="min-h-0 flex-1 overflow-hidden p-3"
        style={{ background: 'var(--canvas-card-bg)' }}
      >
        <div
          className="h-full overflow-y-auto"
          style={{
            border: '2.5px solid var(--canvas-card-border)',
            borderRadius: 6,
            boxShadow:
              'inset 0 0 0 1px rgba(255, 255, 255, 0.6), inset 0 2px 6px rgba(0, 0, 0, 0.05)',
            background: 'var(--canvas-card-bg)',
          }}
        >
          <div data-canvas-body className="h-full">
            <ExpandedBody />
          </div>
        </div>
      </div>
      {/* 위젯 국소 대기 오버레이 — 이 위젯이 동시사용 정원 초과로 대기 중일
          때만 카드 전체를 덮는다. 다른 위젯·캔버스는 정상. */}
      <WidgetGateOverlay widget={content.key} />
    </div>
  );
}
