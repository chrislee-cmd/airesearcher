'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetSetupShell — V2 Unified Widget Canvas 의 공유 카드 셸 (1회 빌드).

   design-handoff SSOT (`Widgets Canvas 1c.dc.html` 프레임 + README "Frame
   spec") 을 전용 토큰으로 재현한다. 6위젯이 이 하나를 공유 (recruiting 최초,
   desk-v3 재사용) — 위젯마다 다른 건 (a) 헤더 파스텔 + credit, (b) body,
   (c) footer CTA/status 뿐. 프레임(radius20·border3·shadow4·헤더밴드·툴바
   pill·푸터 pill)은 전부 절대값.

   ⚠️ AUTHORITY: 프레임 값은 dedicated --widget-* 토큰만 참조 —
   generic DS 토큰(radius-sm=14 · surface-banner=#ffd53d)으로 폴백 금지.
   바깥 W×H 만 컨테이너 소유(반응형) — 나머지는 절대값.
   ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './icons';
import type { DragHandleProps } from '../shell/widget-shell';
import {
  WidgetHeaderColorPicker,
  useWidgetHeaderColor,
} from '../shell/widget-header-color';
import { WidgetGateOverlay } from '@/components/widget-gate-overlay';

const MONO = 'ui-monospace, Menlo, monospace';

export type SetupShellStatus = {
  // dot 색 CSS 변수 (예: 'var(--widget-green)' READY · 'var(--widget-amore)' LIVE).
  dot: string;
  // uppercase 라벨 (예: 'READY' · 'LIVE' · 'Collecting').
  text: string;
};

export type SetupShellCta = {
  // 아이콘 이름 (icons.tsx). mono stroke, 상태색.
  icon?: string;
  text: string;
  enabled: boolean;
  onClick?: () => void;
};

// 헤더 우측 아이콘 툴바 pill (credit │ status │ palette │ expand).
function ToolbarPill({
  creditLabel,
  pastelVar,
  status,
  headerColor,
  setHeaderColor,
  onFullview,
  fullviewLabel,
}: {
  creditLabel: string;
  pastelVar: string;
  status: SetupShellStatus;
  headerColor: string | null;
  setHeaderColor: (c: string | null) => void;
  onFullview?: () => void;
  fullviewLabel: string;
}) {
  const divider = (
    <div aria-hidden style={{ width: 1.5, background: 'var(--widget-ink)' }} />
  );
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: '1.5px solid var(--widget-ink)',
        borderRadius: 10,
        background: 'var(--widget-surface-card)',
        boxShadow: 'var(--widget-toolbar-shadow)',
        overflow: 'hidden',
        flexShrink: 0,
        color: 'var(--widget-ink)',
      }}
    >
      {/* 1 · credit */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 10px',
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <Icon name="diamond" size={14} fill={pastelVar} />
        <span>{creditLabel}</span>
      </div>
      {divider}
      {/* 2 · status */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '1px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: status.dot,
            display: 'inline-block',
          }}
        />
        {status.text}
      </div>
      {divider}
      {/* 3 · palette (color change) — 기존 헤더 색 토글 재사용 */}
      <div
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WidgetHeaderColorPicker value={headerColor} onChange={setHeaderColor} />
      </div>
      {divider}
      {/* 4 · expand / fullview */}
      <div
        role="button"
        tabIndex={0}
        aria-label={fullviewLabel}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFullview?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFullview?.();
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 10px',
          cursor: onFullview ? 'pointer' : 'default',
        }}
      >
        <Icon name="fullview" size={15} strokeWidth={2.6} mono />
      </div>
    </div>
  );
}

export function WidgetSetupShell({
  widgetKey,
  title,
  pastelVar,
  creditLabel,
  status,
  footNote,
  cta,
  fullviewLabel,
  onFullview,
  dragHandleProps,
  children,
}: {
  widgetKey: string;
  title: string;
  // 헤더 파스텔 CSS 변수 (예: 'var(--widget-header-sun)').
  pastelVar: string;
  // 툴바 credit 세그먼트 텍스트 (예: '10' · 'PREVIEW').
  creditLabel: string;
  status: SetupShellStatus;
  footNote: string;
  cta: SetupShellCta;
  fullviewLabel: string;
  onFullview?: () => void;
  dragHandleProps?: DragHandleProps;
  children: ReactNode;
}) {
  const [headerColor, setHeaderColor] = useWidgetHeaderColor(widgetKey);
  const isDraggable = !!dragHandleProps?.draggable;

  const ctaStyle: CSSProperties = cta.enabled
    ? {
        background: 'var(--widget-ink)',
        color: 'var(--widget-surface-card)',
        border: '1.4px solid var(--widget-ink)',
      }
    : {
        background: 'var(--widget-cta-disabled-bg)',
        color: 'var(--widget-muted-2)',
        border: '1.4px solid var(--widget-cta-disabled-border)',
      };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{
        background: 'var(--widget-surface-card)',
        border: '3px solid var(--widget-card-border)',
        borderRadius: 'var(--widget-card-radius)',
        boxShadow: 'var(--widget-card-shadow)',
      }}
    >
      {/* 헤더밴드 — 파스텔 bg + Outfit 800/29 타이틀 + 툴바 pill. drag handle. */}
      <div
        className={`flex shrink-0 items-center justify-between gap-3 ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        {...dragHandleProps}
        style={{
          background: headerColor ?? pastelVar,
          borderBottom: '2px solid var(--widget-header-divider)',
          padding: '18px 22px',
        }}
      >
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-outfit), var(--font-sans)',
            fontWeight: 800,
            fontSize: 29,
            letterSpacing: '-0.9px',
            color: 'var(--widget-ink)',
          }}
        >
          {title}
        </div>
        <ToolbarPill
          creditLabel={creditLabel}
          pastelVar={pastelVar}
          status={status}
          headerColor={headerColor}
          setHeaderColor={setHeaderColor}
          onFullview={onFullview}
          fullviewLabel={fullviewLabel}
        />
      </div>

      {/* body slot — rail 이 내부 스크롤 소유 */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      {/* 푸터 — footnote + ink CTA pill */}
      <div
        className="flex shrink-0 items-center justify-between gap-3"
        style={{
          padding: '15px 22px',
          borderTop: '1px solid var(--widget-footer-divider)',
          background: 'var(--widget-surface-card)',
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--widget-muted-2)' }}>
          {footNote}
        </div>
        <div
          role="button"
          tabIndex={cta.enabled ? 0 : -1}
          aria-disabled={!cta.enabled}
          onClick={() => cta.enabled && cta.onClick?.()}
          onKeyDown={(e) => {
            if (cta.enabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              cta.onClick?.();
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            borderRadius: 999,
            padding: '11px 20px',
            fontWeight: 700,
            fontSize: 13.5,
            boxShadow: 'var(--widget-cta-shadow)',
            cursor: cta.enabled ? 'pointer' : 'not-allowed',
            ...ctaStyle,
          }}
        >
          {cta.icon && <Icon name={cta.icon} size={15} mono />}
          <span>{cta.text}</span>
        </div>
      </div>

      {/* 동시사용 정원 초과 대기 오버레이 (기존 재사용) */}
      <WidgetGateOverlay widget={widgetKey} />
    </div>
  );
}
