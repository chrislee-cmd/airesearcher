'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── SuperadminInspector — 슈퍼어드민 DS primitive 인스펙터 ─────────────────────
// 슈퍼어드민이 제품 화면 위에서 **Ctrl(또는 Cmd)+Shift 를 누른 채 hover** 하면,
// 커서 아래 요소가 어떤 DS primitive 인지(예: `ChipInput`, `Button`)를 커서 옆
// 작은 배지로 보여준다. 카탈로그(/design-system) ↔ 실화면 매핑을 즉시 확인하는
// 개발/디자인 도구.
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

type Match = {
  name: string;
  x: number;
  y: number;
};

// Ctrl(또는 Cmd)+Shift 동시 held 여부. mousemove/keyup 이벤트의 modifier flag 로
// 직접 판정 — 별도 keydown state 추적 없이 이벤트가 실어오는 상태를 읽는다.
function isInspectModifier(e: MouseEvent | KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey;
}

function InspectorOverlay() {
  const [match, setMatch] = useState<Match | null>(null);

  useEffect(() => {
    // mousemove 는 rAF 로 throttle — inspect 모드(키 held) 중에만 실제 작업.
    let raf = 0;
    let pending: MouseEvent | null = null;

    const process = () => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;

      if (!isInspectModifier(e)) {
        // 수식자 미held — 오버레이 즉시 제거(이전에 떠 있었다면).
        setMatch((prev) => (prev == null ? prev : null));
        return;
      }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      // 조상 방향으로 가장 가까운(=innermost, most specific) primitive 1개.
      const hit = el?.closest<HTMLElement>('[data-ds-primitive]');
      const name = hit?.getAttribute('data-ds-primitive') ?? null;
      setMatch(name ? { name, x: e.clientX, y: e.clientY } : null);
    };

    const onMove = (e: MouseEvent) => {
      pending = e;
      if (!raf) raf = requestAnimationFrame(process);
    };

    // 키를 떼는 즉시 사라짐(hold 방식 — 지속 토글 아님).
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isInspectModifier(e)) setMatch(null);
    };
    // 창 포커스 이탈(예: Cmd+Tab)로 keyup 을 놓치는 경우 대비.
    const onBlur = () => setMatch(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!match || typeof document === 'undefined') return null;

  // 커서 우하단 오프셋 + 뷰포트 경계 clamp. 정확한 배지 폭은 모르므로 이름 길이로
  // 근사(px)해 우측/하단 넘침만 반대편으로 뒤집는다.
  const OFFSET = 14;
  const estW = 16 + match.name.length * 7.5 + 18; // 좌우 패딩 + accent dot 대략치
  const estH = 26;
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
      className="pointer-events-none fixed z-overlay flex items-center gap-1.5 whitespace-nowrap rounded-xs border-[2px] border-ink bg-paper px-2 py-0.5 text-xs-soft font-semibold text-ink shadow-memphis-sm"
      style={{ left, top }}
    >
      <span aria-hidden className="text-amore">
        ◆
      </span>
      <span className="font-mono tracking-tight">{match.name}</span>
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
