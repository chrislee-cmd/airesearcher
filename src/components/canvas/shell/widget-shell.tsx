'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetShell — production canvas 카드 셸.

   **Soft Identity 리브랜드 1단계** — 셸 4계층 중 ①. 변환표
   (design-handoff/soft-identity/README.md) 그대로:
   - 카드 chrome: 흰 bg + **1px `--line`** + radius 20(`--r-widget`) +
     **`--sh-card`**(블러 4단계 중 1단). 하드 오프셋 그림자 0.
   - 헤더 띠: **`--tint-*`** bg + border-b **1px `--hair`** + 왼쪽 **40 원색
     아이콘 타일**(원색은 작은 면에만 — 핵심규칙 3) + Bricolage 제목.
   - 툴바: 흰 bg + 1px `--line` + radius 10 + 셀 구분 1px `--hair` + 그림자 없음.
   - 치수·레이아웃·상호작용 무변경(카드 604×900 · 패딩/슬롯 그대로) — 시각 값만.
   - 본문은 **2단계 소유** — data-canvas-body 의 Memphis scoped CSS 는 그대로
     두므로 본문이 한동안 Memphis 혼재로 보이는 것이 정상이다.
   - 헤더 영역 = drag handle (parent 가 dragHandleProps wire).
   ──────────────────────────────────────────────────────────────────── */

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
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
import { WidgetStatePill } from './widget-state-pill';
import { WidgetCreditBadge } from './widget-credit-badge';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { widgetIconFor } from './widget-icon';
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

// 세그 디바이더 — Soft: 1px `--hair` 세로선(변환표 "셀 구분 1px --hair").
// 셀 사이에만(×N-1) 삽입 — full-bleed 세로 rule (align-items:stretch).
function ToolbarDivider() {
  return (
    <span
      aria-hidden
      className="shrink-0 self-stretch"
      style={{ width: 1, background: 'var(--hair)' }}
    />
  );
}

// 헤더 띠 왼쪽 40 원색 아이콘 타일 (변환표 "왼쪽에 40 원색 아이콘 타일").
// 띠가 틴트로 옅어진 만큼 위젯 정체성 원색은 이 타일이 들고 간다 —
// bg = `--widget-tone`(유저 색 ?? accent 원색), 글리프는 흰 채움 + ink 1.8
// 스트로크(duotone 세트 규칙 유지, README §Assets). radius 는 `--r-inner`(10).
function WidgetIconTile({ widgetKey }: { widgetKey: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: 40,
        height: 40,
        borderRadius: 'var(--r-inner)',
        background: 'var(--widget-tone)',
      }}
    >
      <DuotoneIcon
        name={widgetIconFor(widgetKey)}
        size={22}
        fill="var(--surface)"
      />
    </span>
  );
}

// 툴바 v2 셀 공유 지오메트리 — 44px 폭 고정 + center + 6px 세로 패딩(CD SPEC §2).
// credit 값(25/50/75)이 바뀌어도 폭 불변. 아이콘 셀만 cursor/hover(paper-soft).
const TOOLBAR_CELL_STYLE: CSSProperties = {
  width: 44,
  padding: '6px 0',
  color: 'var(--ink)',
};

// 가이드 `?` 글리프 — CD .dc.html SVG path (viewBox 0 0 24 24 · stroke ink 2.2 ·
// circle r=9 + 물음표 stroke + 1.15r dot). 이모지 금지. decorative + aria-hidden.
function GuideIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 9.3a2.7 2.7 0 1 1 3.7 2.5c-.7.3-1.1 1-1.1 1.8v.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="17.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 풀뷰 확장 화살표 글리프 — CD .dc.html SVG path (viewBox 0 0 24 24 · stroke ink
// 2.6). 기존 DuotoneIcon fullview 대신 CD 글리프를 SSOT 로(픽셀 diff 정합).
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4H4v5M4 4l6 6M15 20h5v-5M20 20l-6-6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 통합 툴바 pill — chrome(1.5px ink border · radius 10 · memphis-sm · bg-paper).
// 셀 순서(좌→우 고정, CD SPEC §2): 💎 크레딧 │ ? 가이드 │ 🎨 색상 │ ⤢ 풀뷰.
// v2 변경: (1) 상태 pill 제거(세션 상태는 컨텍스트/사이드바 배지가 계속 보유 —
// 회귀 0), (2) 가이드 ? 버튼 신설(hasGuide+onGuide 게이트, 영상 config 없는
// 위젯은 미노출 → 빈 모달 방지), (3) 4셀 전부 44px 폭 고정. 🎨 = 기존
// WidgetHeaderColorPicker 재배치, 듀오톤 글리프(fill var(--widget-tone))로 현재
// 헤더 톤 표시. divider 는 렌더된 셀 사이에만 삽입.
function WidgetToolbar({
  cost,
  costLabel,
  headerColor,
  onHeaderColorChange,
  onFullview,
  fullviewLabel,
  hasGuide,
  onGuide,
  guideLabel,
}: {
  cost: number | undefined;
  costLabel: string | undefined;
  headerColor: string | null;
  onHeaderColorChange: (color: string | null) => void;
  onFullview?: () => void;
  fullviewLabel: string;
  // 가이드 게이트 — hasGuide(596 의 widget-guides config 유무) && onGuide 둘 다
  // 있어야 버튼 노출. PR-A 단독 머지 시엔 아무도 안 넘겨 미노출(회귀 0).
  hasGuide?: boolean;
  onGuide?: () => void;
  guideLabel: string;
}) {
  const hasCredit = costLabel != null || typeof cost === 'number';
  const showGuide = !!hasGuide && !!onGuide;

  // 렌더될 셀만 모아 divider 를 셀 사이에만(×N-1) 삽입 — 조건부 셀에도
  // 선행/후행/이중 divider 가 안 생긴다.
  const cells: ReactNode[] = [];
  if (hasCredit) {
    cells.push(
      <span
        key="credit"
        className="inline-flex items-center justify-center font-mono font-bold tabular-nums"
        // 숫자 크레딧(25/50/75)은 44px 안에 센터(CD 불변식 유지). 단, AI UT 처럼
        // costLabel 이 단어("PREVIEW")면 44px 고정 시 3줄로 깨진다(CD 미도해 케이스)
        // → minWidth 44 + nowrap 로 숫자는 44 유지, 단어 라벨만 한 줄로 자라남.
        style={{
          minWidth: 44,
          padding: '6px 6px',
          color: 'var(--ink)',
          fontFamily: 'var(--font-mono-soft)',
          gap: 5,
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        <DuotoneIcon name="diamond" size={14} />
        <span>{costLabel ?? cost}</span>
      </span>,
    );
  }
  if (showGuide) {
    cells.push(
      // eslint-disable-next-line react/forbid-elements -- 툴바 세그 아이콘 버튼(?). ui/ IconButton 의 memphis chrome 은 컴팩트 세그먼트 pill 안에서 이중 보더로 보여 부적합 — 셸 카드 프레임 정의 지점의 bare 세그 버튼(⤢/🎨 와 동일 사유).
      <button
        key="guide"
        type="button"
        // 헤더밴드 = drag handle. 툴바 클릭이 카드 drag 를 트리거하지 않게 차단.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onGuide?.();
        }}
        title={guideLabel}
        aria-label={guideLabel}
        className="inline-flex cursor-pointer items-center justify-center hover:bg-soft-fill"
        style={TOOLBAR_CELL_STYLE}
      >
        <GuideIcon />
      </button>,
    );
  }
  cells.push(
    <WidgetHeaderColorPicker
      key="palette"
      value={headerColor}
      onChange={onHeaderColorChange}
      variant="segment"
    />,
  );
  if (onFullview) {
    cells.push(
      // eslint-disable-next-line react/forbid-elements -- 툴바 세그 아이콘 버튼(⤢). ui/ IconButton 의 memphis chrome 은 컴팩트 세그먼트 pill 안에서 이중 보더로 보여 부적합 — 셸 카드 프레임 정의 지점의 bare 세그 버튼.
      <button
        key="expand"
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFullview();
        }}
        title={fullviewLabel}
        aria-label={fullviewLabel}
        className="inline-flex cursor-pointer items-center justify-center hover:bg-soft-fill"
        style={TOOLBAR_CELL_STYLE}
      >
        <ExpandIcon />
      </button>,
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-stretch"
      // Soft: 흰 bg · 1px --line · radius 10 · **그림자 없음**(핵심규칙 2 —
      // 버튼/칩/배지/입력에는 그림자가 없다).
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--widget-card-frame-toolbar-radius)',
        overflow: 'hidden',
      }}
    >
      {cells.map((cell, i) => (
        <Fragment key={i}>
          {i > 0 && <ToolbarDivider />}
          {cell}
        </Fragment>
      ))}
    </span>
  );
}

export function WidgetShell({
  content,
  dragHandleProps,
  onFullview,
  hasGuide,
  onGuide,
  subbarEnd,
}: {
  content: WidgetContent;
  // 호출부 의도 표식 (현재는 default 동작).
  dashboardMode?: boolean;
  // 부모가 위젯 순서 변경 dnd 를 wire-up. 헤더 영역에 spread.
  dragHandleProps?: DragHandleProps;
  // state pill 하단 "전체 보기" 진입점. 넘기는 위젯이 있을 때만 버튼 노출 —
  // 미전달이면 버튼 0 → 회귀 0 (PR-C 가 위젯별 wire).
  onFullview?: () => void;
  // 가이드 ? 버튼 게이트 — 영상 가이드가 있는 위젯(596 의 widget-guides
  // config)일 때만 hasGuide=true. onGuide 는 클릭 시 모달 오픈 콜백(596 wire).
  // PR-A 단독 머지 시엔 호출부가 안 넘겨 버튼 미노출(빈 모달 방지 · 회귀 0).
  hasGuide?: boolean;
  onGuide?: (widgetKey: string) => void;
  // ── 서브바 우측 슬롯 (widget-chain D) ─────────────────────────────────
  // 헤더밴드 바로 아래 얇은 서브바의 **우측**에 꽂히는 단일 슬롯. 지금 유일한
  // 소비자는 체인 칩(ChainChip)이고, 셸은 칩에 대해 아무것도 모른다 — 노드를
  // 그대로 그릴 뿐이다(프레젠테이션 경계 유지, CD HANDOFF §2 "셸 수정 금지,
  // 슬롯이 없으면 슬롯만 추가").
  //
  // **미전달이면 서브바 자체가 렌더되지 않는다** — 체인에 묶이지 않은 카드는
  // 헤더/툴바/바디 diff 0 (done-when "비체인 카드에 칩 없음"). 빈 서브바를
  // 모든 카드에 깔지 않으려고 slot 유무로 행을 게이트한다.
  subbarEnd?: ReactNode;
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
        hasGuide={hasGuide}
        onGuide={onGuide}
        subbarEnd={subbarEnd}
      />
    </WidgetStateProvider>
  );
}

function WidgetShellInner({
  content,
  dragHandleProps,
  onFullview,
  hasGuide,
  onGuide,
  subbarEnd,
}: {
  content: WidgetContent;
  dragHandleProps?: DragHandleProps;
  onFullview?: () => void;
  hasGuide?: boolean;
  onGuide?: (widgetKey: string) => void;
  subbarEnd?: ReactNode;
}) {
  const { ExpandedBody } = content;
  const isDraggable = !!dragHandleProps?.draggable;
  const [headerColor, setHeaderColor] = useWidgetHeaderColor(content.key);
  const tWidgets = useTranslations('Widgets');
  const tRoot = useTranslations();

  // ── Canvas 1c 카드 프레임 variant (probing·interpreter) ────────────────
  // 옐로 banner-top chrome 대신 틴트 헤더밴드 + 통합 툴바 + (위젯 바디의
  // 기존) 푸터 CTA. 카드 셸 = border 1px --line · radius 20 · --sh-card (Soft).
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
          // 래퍼 기준이라 무관, 카드만 실측 규격으로 축소.
          // 콘텐츠 컬럼(514)은 카드 폭이 604 로 좁아지며 정합된다(풀폭 필드).
          width: 604,
          height: 900,
          maxWidth: '100%',
          // Soft 변환표 — border 3 ink → 1 --line · 하드 오프셋 → --sh-card.
          // radius 20 은 불변(--widget-card-frame-radius = CD --r-widget).
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--widget-card-frame-radius)',
          boxShadow: 'var(--sh-card)',
          // ── 헤더↔아이콘 톤 매칭 단일 소스 (R7/D1) ────────────────────────
          // 해상된 헤더 톤을 CSS 변수 하나로 카드 하위 전체에 노출한다:
          //   유저 per-widget 색(headerColor) > accent 파스텔 > 전역 default.
          // 헤더밴드 bg · DuotoneIcon fill · 팔레트글리프 fill 이 모두 이 var 를
          // 읽어 → 🎨 로 색을 바꾸면 헤더+카드내 아이콘+🎨 글리프가 동시 리틴트.
          '--widget-tone':
            headerColor ??
            `var(--widget-header-bg-${content.meta.accent}, var(--canvas-card-header-bg))`,
          // ── 헤더 띠 틴트 (Soft 핵심규칙 3) ────────────────────────────
          // 넓은 면(헤더 띠)은 원색이 아니라 틴트. accent 기본값은 CD 틴트
          // 토큰을 그대로 쓰고, 유저가 🎨 로 고른 임의 색(hsl)은 틴트 토큰이
          // 없으므로 같은 색을 흰색에 22% 섞어 "그 색의 틴트"를 만든다 —
          // 색 원자를 새로 발명하지 않고 유저 선택을 보존하는 유일한 경로.
          '--widget-tint': headerColor
            ? `color-mix(in srgb, ${headerColor} 22%, var(--surface))`
            : `var(--tint-${content.meta.accent}, var(--surface-2))`,
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
            // 헤더밴드 bg = var(--widget-tint) (넓은 면 = 틴트). 원색
            // var(--widget-tone) 은 왼쪽 40 아이콘 타일·카드 내 듀오톤
            // 채움·🎨 글리프가 계속 쓴다 — 🎨 변경 시 둘이 함께 리틴트되는
            // 단일 소스 구조는 그대로.
            background: 'var(--widget-tint)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-display)',
            borderBottom: '1px solid var(--hair)',
            // 패딩은 불변 — 제약("치수·레이아웃 무변경"). CD 02 의 20/24 는
            // 적용하지 않는다(현행 18/22 유지).
            padding: '18px 22px',
          }}
        >
          <span className="flex min-w-0 items-center gap-3">
            <WidgetIconTile widgetKey={content.key} />
            {/* 제목 — CD 02 "Bricolage 24/700 ls −0.6"(기존 Outfit 29/800).
                한글 제목은 Bricolage 글리프가 없어 Pretendard 로 폴백되는 것이
                의도다(README §Assets). */}
            <span
              className="min-w-0 truncate"
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.6px',
                lineHeight: 1.1,
                color: 'var(--ink)',
              }}
            >
              {resolveWidgetLabel(tRoot, content.meta)}
            </span>
          </span>
          <WidgetToolbar
            cost={content.meta.cost}
            costLabel={content.meta.costLabel}
            headerColor={headerColor}
            onHeaderColorChange={setHeaderColor}
            onFullview={onFullview}
            fullviewLabel={tWidgets('fullview')}
            hasGuide={hasGuide}
            onGuide={onGuide ? () => onGuide(content.key) : undefined}
            guideLabel={tWidgets('guide')}
          />
          <CostFlyUpOverlay featureKey={content.key} />
        </div>
        {/* 서브바 — 헤더밴드와 바디 사이의 얇은 행. subbarEnd 슬롯이 있을 때만
            렌더(= 체인에 묶인 카드만). 슬롯은 우측 정렬(ml-auto)이다. */}
        {subbarEnd && (
          <div
            data-widget-subbar
            className="flex min-h-[33px] shrink-0 items-center gap-[7px] border-b border-soft-hair bg-soft-surface-2 px-[15px] py-[7px]"
          >
            <span className="ml-auto inline-flex items-center">{subbarEnd}</span>
          </div>
        )}
        {/* 바디 — overflow-hidden(내부 ControlBoardPanel 이 스크롤). framed inner
            frame 없음(카드 프레임이 셸을 대체). data-canvas-body 유지 →
            Memphis bold/display scoped CSS 가 아코디언 button/input 에 적용. */}
        <div
          className="min-h-0 flex-1 overflow-hidden"
          style={{ background: 'var(--surface)' }}
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
      // Soft 변환표(위 cardFrame 과 동일 규칙) — 준비중/숨김 위젯이 쓰는
      // 레거시 banner-top 셸도 같은 셸 계층이라 함께 전환한다.
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-widget)',
        boxShadow: 'var(--sh-card)',
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
          // 우선순위는 그대로(사용자 색 > 행 색 > 전역 default). Soft 에서는
          // 넓은 면이므로 유저 색도 틴트로 섞고(핵심규칙 3), 기본값은 accent
          // 틴트 토큰. 행 색 주입(--widget-header-row-bg)은 폴백으로 유지.
          background: headerColor
            ? `color-mix(in srgb, ${headerColor} 22%, var(--surface))`
            : `var(--widget-header-row-bg, var(--tint-${content.meta.accent}, var(--surface-2)))`,
          color: 'var(--ink)',
          fontFamily: 'var(--font-display)',
          borderBottom: '1px solid var(--hair)',
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
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '-0.6px',
            lineHeight: 1.1,
            color: 'var(--ink)',
          }}
        >
          {resolveWidgetLabel(tRoot, content.meta)}
        </div>
      </div>
      {/* framed body — Soft 1px --hair inner frame(그림자 없음). 그 안쪽
          wrapper 는 data-canvas-body 유지 — 본문 typography/컨트롤 scoped rule
          은 2단계 소유라 건드리지 않는다. */}
      <div
        className="min-h-0 flex-1 overflow-hidden p-3"
        style={{ background: 'var(--surface)' }}
      >
        <div
          className="h-full overflow-y-auto"
          // Soft: 액자의 2.5px ink + inset 하드 그림자 → 1px --hair · radius 10.
          // (핵심규칙 1/2 — 1.5/2/2.5/3px 보더와 하드 그림자는 전부 없앤다.)
          style={{
            border: '1px solid var(--hair)',
            borderRadius: 'var(--r-inner)',
            background: 'var(--surface)',
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
