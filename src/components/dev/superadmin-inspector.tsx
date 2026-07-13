'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── SuperadminInspector — 슈퍼어드민 DS primitive 인스펙터 ─────────────────────
// 슈퍼어드민이 제품 화면 위에서 **Ctrl(또는 Cmd)+Shift 를 누른 채 hover** 하면,
// 커서 아래 요소가 어떤 DS primitive 인지(예: `ChipInput`, `Button`)와 그 요소의
// **pixel 치수**(W×H · padding · margin · gap)를 커서 옆 배지로 보여준다.
// 여기에 **Alt 를 추가로 누르면** 커서 아래 요소를 참조 A 로 잠그고, 다른 요소 B
// 위로 이동하면 A↔B 최근접 edge 간 거리를 DevTools 처럼 점선 가이드 + px 라벨로
// 실시간 렌더한다. 카탈로그(/design-system) ↔ 실화면 매핑 + 간격 감사 도구.
//
// 이름 SSOT: 각 primitive 가 자기 루트에 부착한 `data-ds-primitive="<카탈로그
// label>"`. 이 값은 design-system/components/sections.tsx 의 SECTION_GROUPS
// label(= 컴포넌트 함수명)과 1:1 이다.
//
// 게이트: isSuperAdminEmail 은 서버 전용이라 서버 layout 이 `isSuperAdmin` bool
// prop 을 내려준다(Topbar 선례와 동일). **isSuperAdmin=false 면 리스너 0·렌더 0** —
// Provider 는 아무 것도 마운트하지 않는다(제로 오버헤드 + 일반 사용자 노출 0).
//
// data-ds-primitive attr 자체는 모든 사용자 DOM 에 존재한다(값=컴포넌트 이름,
// data-testid 급 비민감 정보). 가시화(오버레이)만 이 게이트 뒤에 있다 — primitive
// 마다 조건부 방출하는 건 과설계라 지양.

type Box = { top: number; right: number; bottom: number; left: number };

type Match = {
  name: string;
  x: number; // 커서 (배지 위치)
  y: number;
  rect: DOMRect; // hit.getBoundingClientRect()
  pad: Box;
  mar: Box;
  gap: { row: number; col: number } | null; // flex/grid 컨테이너일 때만
};

// 거리 측정 모드 스냅샷 — A(잠금) 와 B(현재 hover) 의 rect + 이름.
type Measure = {
  aName: string;
  aRect: DOMRect;
  bName: string | null;
  bRect: DOMRect | null;
};

// Ctrl(또는 Cmd)+Shift 동시 held 여부. mousemove/keydown/keyup 이벤트의 modifier
// flag 로 직접 판정 — 이벤트가 실어오는 상태를 읽는다.
function isInspectModifier(e: MouseEvent | KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey;
}

// getComputedStyle 의 px 문자열을 정수로. 반올림해 DevTools computed 와 ±1px 매칭.
function pxInt(v: string): number {
  return Math.round(parseFloat(v) || 0);
}

// padding/margin 4변을 한 번의 getComputedStyle 읽기에서 뽑는다.
function readBox(cs: CSSStyleDeclaration, prop: 'padding' | 'margin'): Box {
  return {
    top: pxInt(cs.getPropertyValue(`${prop}-top`)),
    right: pxInt(cs.getPropertyValue(`${prop}-right`)),
    bottom: pxInt(cs.getPropertyValue(`${prop}-bottom`)),
    left: pxInt(cs.getPropertyValue(`${prop}-left`)),
  };
}

// hit 요소 1개에서 rect + computed box 값을 1회씩만 읽는다(레이아웃 thrash 루프 금지).
function readDims(hit: HTMLElement): Omit<Match, 'name' | 'x' | 'y'> {
  const rect = hit.getBoundingClientRect();
  const cs = getComputedStyle(hit);
  const pad = readBox(cs, 'padding');
  const mar = readBox(cs, 'margin');
  let gap: { row: number; col: number } | null = null;
  if (/flex|grid/.test(cs.display)) {
    const row = pxInt(cs.rowGap);
    const col = pxInt(cs.columnGap);
    if (row !== 0 || col !== 0) gap = { row, col };
  }
  return { rect, pad, mar, gap };
}

const isZeroBox = (b: Box) =>
  b.top === 0 && b.right === 0 && b.bottom === 0 && b.left === 0;

// 4변 압축 표기: 전부 동일 → `8`, 세로/가로 쌍 → `8 12`, 그 외 → `t r b l`.
function fmtBox(b: Box): string {
  const { top, right, bottom, left } = b;
  if (top === right && right === bottom && bottom === left) return `${top}`;
  if (top === bottom && left === right) return `${top} ${right}`;
  return `${top} ${right} ${bottom} ${left}`;
}

// hover 요소 배지에 실을 치수 라인들(W×H 는 항상, pad/mar 은 0 아닐 때만).
function dimLines(m: Match): string[] {
  const lines = [`${Math.round(m.rect.width)}×${Math.round(m.rect.height)}`];
  if (!isZeroBox(m.pad)) lines.push(`pad ${fmtBox(m.pad)}`);
  if (!isZeroBox(m.mar)) lines.push(`mar ${fmtBox(m.mar)}`);
  if (m.gap) {
    lines.push(
      m.gap.row === m.gap.col ? `gap ${m.gap.row}` : `gap ${m.gap.row}×${m.gap.col}`,
    );
  }
  return lines;
}

// ── DevTools 거리 기하 ─────────────────────────────────────────────────────
// A/B 두 rect 의 최근접 edge 간 수평/수직 gap 을 구한다. 겹치는 축은 null(라인 생략).
type Seg = { x1: number; y1: number; x2: number; y2: number; d: number };

function distanceGeom(a: DOMRect, b: DOMRect): { h: Seg | null; v: Seg | null } {
  let h: Seg | null = null;
  if (b.left >= a.right) {
    h = { x1: a.right, x2: b.left, y1: 0, y2: 0, d: Math.round(b.left - a.right) };
  } else if (b.right <= a.left) {
    h = { x1: b.right, x2: a.left, y1: 0, y2: 0, d: Math.round(a.left - b.right) };
  }
  if (h) {
    // 두 요소가 수직으로 겹치면 그 겹침 구간 중앙에, 아니면 B 중앙 높이에 라인.
    const oTop = Math.max(a.top, b.top);
    const oBot = Math.min(a.bottom, b.bottom);
    const y = oBot > oTop ? (oTop + oBot) / 2 : (b.top + b.bottom) / 2;
    h.y1 = y;
    h.y2 = y;
  }

  let v: Seg | null = null;
  if (b.top >= a.bottom) {
    v = { x1: 0, x2: 0, y1: a.bottom, y2: b.top, d: Math.round(b.top - a.bottom) };
  } else if (b.bottom <= a.top) {
    v = { x1: 0, x2: 0, y1: b.bottom, y2: a.top, d: Math.round(a.top - b.bottom) };
  }
  if (v) {
    const oLeft = Math.max(a.left, b.left);
    const oRight = Math.min(a.right, b.right);
    const x = oRight > oLeft ? (oLeft + oRight) / 2 : (b.left + b.right) / 2;
    v.x1 = x;
    v.x2 = x;
  }
  return { h, v };
}

// 거리 라벨 배지 — 배지 톤 재사용(작게). pointer-events-none.
function DistLabel({ left, top, text }: { left: number; top: number; text: string }) {
  return (
    <div
      className="pointer-events-none fixed z-overlay -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-xs border-[2px] border-amore bg-paper px-1.5 py-0.5 font-mono text-xs font-semibold text-amore shadow-memphis-xs-amore"
      style={{ left, top }}
    >
      {text}
    </div>
  );
}

// rect 기반 outline 박스 — A/B 구분용. pointer-events-none.
function OutlineBox({
  rect,
  accent,
}: {
  rect: DOMRect;
  accent: boolean;
}) {
  return (
    <div
      className={`pointer-events-none fixed z-overlay rounded-xs border-[2px] ${
        accent ? 'border-amore' : 'border-ink'
      }`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

function InspectorOverlay() {
  const [match, setMatch] = useState<Match | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);

  // 거리 모드에서 잠근 참조 A. rect 는 매 프레임 el 에서 새로 읽어 스크롤/reflow 에도
  // 정확하게 유지(el 이 DOM 에서 제거되면 잠금 해제).
  const lockedARef = useRef<{ el: HTMLElement; name: string } | null>(null);
  // 마우스가 멈춘 상태에서 Alt keydown 만으로 A 를 잠그려면 마지막 커서 위치가 필요.
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    let raf = 0;
    let pending: MouseEvent | null = null;

    const clearAll = () => {
      lockedARef.current = null;
      setMatch(null);
      setMeasure(null);
    };

    // 커서(x,y) + modifier 조합으로 현재 상태를 계산한다. mousemove·keydown·keyup 이
    // 공유하는 단일 진입점.
    const evaluate = (x: number, y: number, mod: boolean, alt: boolean) => {
      if (!mod) {
        clearAll();
        return;
      }
      const el = document.elementFromPoint(x, y);
      const hit = el?.closest<HTMLElement>('[data-ds-primitive]') ?? null;
      const name = hit?.getAttribute('data-ds-primitive') ?? null;

      if (alt) {
        // ── 거리 측정 모드 ──
        setMatch(null);
        // A 잠금 유지/획득: el 이 사라졌으면 해제.
        const locked = lockedARef.current;
        if (locked && !locked.el.isConnected) lockedARef.current = null;
        if (!lockedARef.current && hit && name) {
          lockedARef.current = { el: hit, name };
        }
        const A = lockedARef.current;
        if (!A) {
          setMeasure(null);
          return;
        }
        const aRect = A.el.getBoundingClientRect();
        // B = 현재 hit(있으면). A 와 동일 요소면 B 없음으로 취급(자기 자신 거리 0 무의미).
        const bIsSelf = hit === A.el;
        setMeasure({
          aName: A.name,
          aRect,
          bName: !hit || bIsSelf ? null : name,
          bRect: !hit || bIsSelf ? null : hit.getBoundingClientRect(),
        });
        return;
      }

      // ── 베이스 치수 배지 모드 ──
      lockedARef.current = null;
      setMeasure(null);
      if (!hit || !name) {
        setMatch((prev) => (prev == null ? prev : null));
        return;
      }
      setMatch({ name, x, y, ...readDims(hit) });
    };

    // mousemove 는 rAF 로 throttle — inspect 모드(키 held) 중에만 실제 작업.
    const process = () => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      evaluate(e.clientX, e.clientY, isInspectModifier(e), e.altKey);
    };

    const onMove = (e: MouseEvent) => {
      pending = e;
      if (!raf) raf = requestAnimationFrame(process);
    };

    // 기본 인스펙터는 keydown state 를 안 쓰지만(이벤트가 실어오는 modifier 만 읽음),
    // 거리 모드는 반응성이 핵심이라 최소 예외로 Alt keydown/keyup 을 직접 처리한다:
    // Alt 를 누른 "순간" 마우스가 멈춰 있어도 커서 아래 요소가 즉시 A 로 잠겨야 하고,
    // Alt 를 떼는 "순간" 베이스 배지로 복귀해야 하기 때문.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearAll();
        return;
      }
      if (e.key === 'Alt' && isInspectModifier(e)) {
        const { x, y } = lastMouseRef.current;
        evaluate(x, y, true, true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Ctrl/Shift 를 뗐으면 전체 클리어(hold 방식).
      if (!isInspectModifier(e)) {
        clearAll();
        return;
      }
      // Alt 만 뗀 경우: 거리 모드 종료 → 베이스 배지로 복귀.
      if (e.key === 'Alt' || !e.altKey) {
        lockedARef.current = null;
        setMeasure(null);
        const { x, y } = lastMouseRef.current;
        evaluate(x, y, true, false);
      }
    };

    // 창 포커스 이탈(예: Cmd+Tab)로 keyup 을 놓치는 경우 대비.
    const onBlur = () => clearAll();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (typeof document === 'undefined') return null;

  // ── 거리 측정 오버레이(우선) ──
  if (measure) {
    const { aRect, bRect, aName, bName } = measure;
    const geom = bRect ? distanceGeom(aRect, bRect) : { h: null, v: null };
    return createPortal(
      <>
        {/* 전체 뷰포트 SVG — 점선 거리 가이드. 좌표는 viewport px(fixed inset-0). */}
        <svg
          className="pointer-events-none fixed inset-0 z-overlay h-full w-full"
          aria-hidden
        >
          {geom.h && (
            <line
              x1={geom.h.x1}
              y1={geom.h.y1}
              x2={geom.h.x2}
              y2={geom.h.y2}
              strokeWidth={1}
              strokeDasharray="4 3"
              className="stroke-amore"
            />
          )}
          {geom.v && (
            <line
              x1={geom.v.x1}
              y1={geom.v.y1}
              x2={geom.v.x2}
              y2={geom.v.y2}
              strokeWidth={1}
              strokeDasharray="4 3"
              className="stroke-amore"
            />
          )}
        </svg>
        <OutlineBox rect={aRect} accent={false} />
        {bRect && <OutlineBox rect={bRect} accent />}
        {/* A 이름 라벨(좌상단 모서리 근처) */}
        <DistLabel left={aRect.left + 2} top={aRect.top - 2} text={`A ${aName}`} />
        {bRect && bName && (
          <DistLabel left={bRect.left + 2} top={bRect.top - 2} text={`B ${bName}`} />
        )}
        {geom.h && (
          <DistLabel
            left={(geom.h.x1 + geom.h.x2) / 2}
            top={geom.h.y1}
            text={`${geom.h.d}px`}
          />
        )}
        {geom.v && (
          <DistLabel
            left={geom.v.x1}
            top={(geom.v.y1 + geom.v.y2) / 2}
            text={`${geom.v.d}px`}
          />
        )}
      </>,
      document.body,
    );
  }

  // ── 베이스 치수 배지 ──
  if (!match) return null;

  const lines = dimLines(match);
  // 커서 우하단 오프셋 + 뷰포트 경계 clamp. 배지 폭/높이는 콘텐츠로 근사해 넘침만
  // 반대편으로 뒤집는다(정확한 측정 불필요 — offscreen 방지용).
  const OFFSET = 14;
  const longest = Math.max(match.name.length, ...lines.map((l) => l.length));
  const estW = 16 + longest * 7.5 + 18;
  const estH = 22 + lines.length * 14;
  let left = match.x + OFFSET;
  let top = match.y + OFFSET;
  if (left + estW > window.innerWidth) left = match.x - OFFSET - estW;
  if (top + estH > window.innerHeight) top = match.y - OFFSET - estH;
  left = Math.max(4, left);
  top = Math.max(4, top);

  return createPortal(
    <div
      // pointer-events-none: hover 방해 금지. z-overlay(=70) 토큰 클래스 —
      // 하드코드 z-index 금지(§3.8 lint gate). Memphis 톤 소형 배지, DS 토큰만.
      className="pointer-events-none fixed z-overlay flex flex-col gap-0.5 whitespace-nowrap rounded-xs border-[2px] border-ink bg-paper px-2 py-1 text-xs-soft font-semibold text-ink shadow-memphis-sm"
      style={{ left, top }}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="text-amore">
          ◆
        </span>
        <span className="font-mono tracking-tight">{match.name}</span>
      </span>
      <span className="flex flex-col gap-0.5 font-mono text-xs text-mute">
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </span>
    </div>,
    document.body,
  );
}

// 서버 layout 스택에 마운트되는 Provider. isSuperAdmin=false 면 완전 no-op
// (InspectorOverlay 미마운트 → 리스너/렌더 0).
export function SuperadminInspectorProvider({
  isSuperAdmin,
}: {
  isSuperAdmin: boolean;
}) {
  if (!isSuperAdmin) return null;
  return <InspectorOverlay />;
}
