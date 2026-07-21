'use client';

/* ────────────────────────────────────────────────────────────────────
   V2 Unified Widget Canvas — 공유 스텝-레일 primitives.

   design-handoff `Widgets Canvas 1c.dc.html` 의 Rail / NodeNum / NodeDone /
   Title / SummaryStep / Handoff 를 그대로 옮긴다. 6위젯 공유(recruiting 최초,
   desk-v3 재사용). 색/그림자는 전부 var(--widget-*) — 하드코드 hex 0.
   숫자 borderRadius/px 는 SSOT 절대값 그대로(check:design 은 문자열 hex/px 만 검출).

   presentational only — 데이터/DOM 배선은 위젯 body(컨테이너)가 소유.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Icon } from './icons';

const MONO = 'ui-monospace, Menlo, monospace';

// 세로 레일 컨테이너 — left:12 에 2px 라인이 top→bottom.
export function Rail({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '22px 24px', height: '100%', overflowY: 'auto' }}>
      <div style={{ position: 'relative', paddingLeft: 38, minHeight: '100%' }}>
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 8,
            bottom: 8,
            width: 2,
            background: 'var(--widget-rail-line)',
          }}
        />
        {children}
      </div>
    </div>
  );
}

// 활성/열린 스텝 노드 — 26 원, ink bg, 흰 숫자. dim=아직 안 온 스텝.
export function NodeNum({ n, dim = false }: { n: number; dim?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: -38,
        top: -2,
        width: 26,
        height: 26,
        borderRadius: 999,
        background: dim ? 'var(--widget-surface-subtle)' : 'var(--widget-ink)',
        color: dim ? 'var(--widget-placeholder)' : 'var(--widget-surface-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12.5,
        fontWeight: 800,
      }}
    >
      {n}
    </div>
  );
}

// 완료 스텝 노드 — green 원 + 흰 ✓.
export function NodeDone() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: -38,
        top: -3,
        width: 26,
        height: 26,
        borderRadius: 999,
        background: 'var(--widget-green)',
        color: 'var(--widget-surface-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 800,
      }}
    >
      ✓
    </div>
  );
}

// 스텝 컨테이너 — 노드 + body. last 스텝은 하단 마진 0.
export function StepRow({
  node,
  last = false,
  children,
}: {
  node: ReactNode;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ position: 'relative', marginBottom: last ? 0 : 26 }}>
      {node}
      {children}
    </div>
  );
}

export function StepTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 14.5,
        fontWeight: 800,
        color: 'var(--widget-ink)',
        marginBottom: 11,
      }}
    >
      {children}
    </div>
  );
}

// 접힘(All Collapsed) 1줄 요약 행 — done 노드 + 라벨/값 + Change 링크.
export function SummaryRow({
  label,
  value,
  changeLabel,
  onChange,
  last = false,
}: {
  label: string;
  value: ReactNode;
  changeLabel: string;
  onChange?: () => void;
  last?: boolean;
}) {
  return (
    <div style={{ position: 'relative', marginBottom: last ? 0 : 22 }}>
      <NodeDone />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--widget-muted)' }}>{label}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--widget-ink)' }}>
            {value}
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange?.();
            }
          }}
          style={{
            fontSize: 12,
            color: 'var(--widget-muted-2)',
            fontWeight: 600,
            cursor: onChange ? 'pointer' : 'default',
            flexShrink: 0,
          }}
        >
          {changeLabel}
        </div>
      </div>
    </div>
  );
}

// handoff / 완료 뷰 (Published 등) — 중앙 정렬 아이콘 배지 + 제목 + 서브.
export function HandoffView({
  title,
  sub,
  backLabel,
  onBack,
}: {
  title: string;
  sub: string;
  backLabel?: string;
  onBack?: () => void;
}) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        textAlign: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          border: '2px solid var(--widget-ink)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '3px 3px 0 var(--widget-ink)',
          color: 'var(--widget-ink)',
        }}
      >
        <Icon name="fullview" size={30} mono />
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--widget-ink)' }}>{title}</div>
      <div
        style={{
          fontSize: 13.5,
          color: 'var(--widget-muted)',
          lineHeight: 1.6,
          maxWidth: 320,
        }}
      >
        {sub}
      </div>
      {backLabel && (
        <div
          role="button"
          tabIndex={0}
          onClick={onBack}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onBack?.();
            }
          }}
          style={{
            fontSize: 12.5,
            color: 'var(--widget-muted-2)',
            fontWeight: 600,
            borderBottom: '1.5px solid var(--widget-border-soft)',
            paddingBottom: 1,
            cursor: onBack ? 'pointer' : 'default',
            fontFamily: MONO,
          }}
        >
          {backLabel}
        </div>
      )}
    </div>
  );
}

export { MONO };
