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
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { resolveWidgetLabel, type WidgetContent } from '../widget-types';
import { Button } from '@/components/ui/button';
import {
  WidgetHeaderColorPicker,
  useWidgetHeaderColor,
} from './widget-header-color';
import {
  WidgetStateProvider,
  useWidgetState,
} from './widget-state-context';
import { WidgetStatePill, widgetStatePillLabel } from './widget-state-pill';
import { WidgetCreditBadge } from './widget-credit-badge';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
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

// ── Canvas 1c 카드 프레임 — 통합 툴바 (💎크레딧 │ ●상태 │ ⤢풀뷰) ──────────
// banner-top chrome 에 분리돼 있던 크레딧 배지·상태 pill·풀뷰 진입을 헤더밴드
// 안 단일 pill 로 병합. probing·interpreter(cardFrame) 세팅 표면 전용.

// 세그 디바이더 — 1.5px ink 세로선.
function ToolbarDivider() {
  return (
    <span
      aria-hidden
      className="shrink-0 self-stretch"
      style={{ width: 1.5, background: 'var(--canvas-card-border)' }}
    />
  );
}

// 상태 세그 — WidgetStateContext 구독(PopStatePill 과 동일 소스), 툴바용 컴팩트
// 표현(● 도트 + 라벨). ready = success(초록)/READY · 라이브 = amore(핑크)/LIVE.
function ToolbarStatusSegment() {
  const { state } = useWidgetState();
  const live = state.kind === 'running';
  return (
    <span
      className="inline-flex items-center gap-1.5 font-bold uppercase tabular-nums tracking-wider"
      style={{ padding: '6px 10px', fontSize: 11, color: 'var(--canvas-card-header-text)' }}
      aria-live={live ? 'polite' : undefined}
      title={state.kind === 'error' && state.message ? state.message : undefined}
    >
      <span
        aria-hidden
        className={live ? 'animate-pulse' : undefined}
        style={{
          width: 7,
          height: 7,
          borderRadius: 'var(--radius-pill)',
          background: live ? 'var(--color-amore)' : 'var(--color-success)',
        }}
      />
      {widgetStatePillLabel(state)}
    </span>
  );
}

// 통합 툴바 pill — chrome(1.5px ink border · radius 10 · memphis-sm · bg-paper).
// 세그 순서(좌→우 고정): 💎 크레딧 │ ● 상태 │ 🎨 색상 변경 │ ⤢ 풀뷰.
// 🎨 = 기존 WidgetHeaderColorPicker 재배치 (신규 구현 아님) — 645 툴바 재작성
// 때 cardFrame 에서 빠진 색상 커스텀을 position #3 에 복원. 팔레트 글리프는
// 듀오톤(fill var(--widget-tone))이라 현재 헤더 톤으로 채워져 상태를 표시.
function WidgetToolbar({
  cost,
  costLabel,
  headerColor,
  onHeaderColorChange,
  onFullview,
  fullviewLabel,
}: {
  cost: number | undefined;
  costLabel: string | undefined;
  headerColor: string | null;
  onHeaderColorChange: (color: string | null) => void;
  onFullview?: () => void;
  fullviewLabel: string;
}) {
  const hasCredit = costLabel != null || typeof cost === 'number';
  return (
    <span
      className="inline-flex shrink-0 items-center"
      style={{
        background: 'var(--canvas-card-bg)',
        border: '1.5px solid var(--canvas-card-border)',
        borderRadius: 'var(--widget-card-frame-toolbar-radius)',
        boxShadow: 'var(--shadow-memphis-sm)',
        overflow: 'hidden',
      }}
    >
      {hasCredit && (
        <span
          className="inline-flex items-center gap-1 font-bold tabular-nums"
          style={{ padding: '6px 10px', fontSize: 11, color: 'var(--canvas-card-header-text)' }}
        >
          <DuotoneIcon name="diamond" size={14} />
          <span>{costLabel ?? cost}</span>
        </span>
      )}
      {hasCredit && <ToolbarDivider />}
      <ToolbarStatusSegment />
      <ToolbarDivider />
      <WidgetHeaderColorPicker
        value={headerColor}
        onChange={onHeaderColorChange}
        variant="segment"
      />
      {onFullview && (
        <>
          <ToolbarDivider />
          {/* eslint-disable-next-line react/forbid-elements -- 툴바 세그 아이콘 버튼(⤢). ui/ IconButton 의 memphis chrome 은 컴팩트 세그먼트 pill 안에서 이중 보더로 보여 부적합 — 셸 카드 프레임 정의 지점의 bare 세그 버튼. */}
          <button
            type="button"
            onClick={onFullview}
            aria-label={fullviewLabel}
            className="inline-flex items-center justify-center"
            style={{ padding: '6px 10px', color: 'var(--canvas-card-header-text)' }}
          >
            <DuotoneIcon name="fullview" size={16} />
          </button>
        </>
      )}
    </span>
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

  // ── Canvas 1c 카드 프레임 variant (probing·interpreter) ────────────────
  // 옐로 banner-top chrome 대신 파스텔 헤더밴드 + 통합 툴바 + (위젯 바디의
  // 기존) 푸터 CTA. 카드 셸 = border 3px ink · radius 20 · shadow-memphis-md.
  // 바디는 overflow-hidden — 내부 ControlBoardPanel(flex-1 overflow-y-auto)이
  // 스크롤 주체, 위젯의 기존 shrink-0 CTA 는 스크롤 밖 형제로 pinned(바디
  // 마크업 무변경, 회귀 0). 크레딧/상태/풀뷰는 chrome 에서 사라지고 툴바로 이동.
  if (content.meta.cardFrame) {
    return (
      <div
        className="relative flex flex-col overflow-hidden"
        aria-expanded
        style={{
          // Canvas 1c 확정 지오메트리(GEOMETRY.md ⚑): 카드 = 고정 604×900.
          // 예전엔 셸이 h-full 로 캔버스 셀(816×950)을 채워 넓어지고(과대폭)
          // 하단 공백(과대높이)이 났다. 604×900 못박고 셀이 넓으면 좌상단
          // 정렬(카드가 셀을 채우지 않음) — 캔버스 그리드/pop-락은 바깥 셀
          // 래퍼(CELL_W×CELL_H) 기준이라 무관, 카드만 실측 규격으로 축소.
          // 콘텐츠 컬럼(514)은 카드 폭이 604 로 좁아지며 정합된다(풀폭 필드).
          width: 604,
          height: 900,
          maxWidth: '100%',
          background: 'var(--canvas-card-bg)',
          border: '3px solid var(--canvas-card-border)',
          borderRadius: 'var(--widget-card-frame-radius)',
          boxShadow: 'var(--shadow-memphis-md)',
          // ── 헤더↔아이콘 톤 매칭 단일 소스 (R7/D1) ────────────────────────
          // 해상된 헤더 톤을 CSS 변수 하나로 카드 하위 전체에 노출한다:
          //   유저 per-widget 색(headerColor) > accent 파스텔 > 전역 default.
          // 헤더밴드 bg · DuotoneIcon fill · 팔레트글리프 fill 이 모두 이 var 를
          // 읽어 → 🎨 로 색을 바꾸면 헤더+카드내 아이콘+🎨 글리프가 동시 리틴트.
          '--widget-tone':
            headerColor ??
            `var(--widget-header-bg-${content.meta.accent}, var(--canvas-card-header-bg))`,
        } as CSSProperties}
      >
        {/* 헤더밴드 — 파스텔(accent) bg · 2px ink bottom border · Outfit 800 29px
            타이틀 + 통합 툴바. 헤더 영역 = drag handle. */}
        <div
          className={`relative flex shrink-0 items-center justify-between gap-3 ${
            isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
          {...dragHandleProps}
          style={{
            // 헤더밴드 bg = var(--widget-tone) (매칭 불변식 단일 소스). 🎨 변경
            // 시 아이콘·팔레트글리프와 동시에 리틴트된다.
            background: 'var(--widget-tone)',
            color: 'var(--canvas-card-header-text)',
            fontFamily: 'var(--font-outfit), var(--font-sans)',
            borderBottom: '2px solid var(--canvas-card-border)',
            padding: '18px 22px',
          }}
        >
          <span
            className="min-w-0 truncate"
            style={{
              fontSize: 29,
              fontWeight: 800,
              letterSpacing: '-0.9px',
              lineHeight: 1.05,
              color: 'var(--canvas-card-header-text)',
            }}
          >
            {resolveWidgetLabel(tRoot, content.meta)}
          </span>
          <WidgetToolbar
            cost={content.meta.cost}
            costLabel={content.meta.costLabel}
            headerColor={headerColor}
            onHeaderColorChange={setHeaderColor}
            onFullview={onFullview}
            fullviewLabel={tWidgets('fullview')}
          />
          <CostFlyUpOverlay featureKey={content.key} />
        </div>
        {/* 바디 — overflow-hidden(내부 ControlBoardPanel 이 스크롤). framed inner
            frame 없음(카드 프레임이 셸을 대체). data-canvas-body 유지 →
            Memphis bold/display scoped CSS 가 아코디언 button/input 에 적용. */}
        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={{ background: 'var(--canvas-card-bg)' }}
        >
          <div data-canvas-body className="flex h-full min-h-0 flex-col">
            <ExpandedBody />
          </div>
        </div>
        <WidgetGateOverlay widget={content.key} />
      </div>
    );
  }

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
          {resolveWidgetLabel(tRoot, content.meta)}
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
