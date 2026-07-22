'use client';

/* ────────────────────────────────────────────────────────────────────
   FullviewShell — 공유 전체보기 모달의 조정 채널.

   CanvasBoard 가 단일 <WidgetFullviewModal> chrome + 좌측 SidebarNav +
   본문 slot 을 렌더하고, 그 state (open / currentKey / slotEl) 를 이
   context 로 위젯 본문들에 내려준다. 각 위젯의 ExpandedBody (= 항상
   마운트된 canvas 카드) 는 자기가 currentKey 일 때만 자기 dense 본문을
   slot 으로 portal 한다.

   왜 portal 인가 (spec 의 FullviewBody + provider hoist 대신):
   - canvas 카드(ExpandedBody)는 모달이 열려 있어도 절대 unmount 되지
     않는다 (surface 위에 항상 존재, 모달은 별도 portal overlay). 따라서
     세션 hook (probing useRealtimeTranscription / translate
     RealtimeTranscriptProvider) 이 카드 안에 살아 있으면 모달 본문을
     swap 해도 세션이 끊기지 않는다 → 가장 위험한 "실시간 세션 hoist" 가
     불필요해진다.
   - 본문은 단일 인스턴스라 두 곳(카드/모달)에 동시에 그려지지 않는다
     (translate console 두 인스턴스 위험 회피).

   Provider 밖(canvas 아닌 곳)에서도 안전 — isCurrent=false, renderInSlot
   은 null, close 는 no-op.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type FullviewShellApi = {
  /** 현재 모달이 보여주는 위젯 key (close 후에도 "마지막 본 위젯" 으로 유지). */
  currentKey: string | null;
  /** 모달 open 여부. */
  open: boolean;
  /**
   * 셸 chrome 형태. 'modal'(기본) = 캔버스 뷰의 전체보기 모달 — 닫기 × 노출.
   * 'page' = 리스트 뷰의 풀페이지 셸 — 좌 사이드바 + 우 상세가 본문 영역을
   * 차지하고, 닫을 모달이 없으므로 상세 패널의 닫기 × 를 감춘다.
   */
  chrome?: 'modal' | 'page';
  /** 위젯 본문이 portal 할 대상 DOM. 모달이 열렸을 때만 non-null. */
  slotEl: HTMLElement | null;
  /**
   * 풀뷰 V2 (fullviewV2) 셸 헤더 스캐폴드의 위젯-주입 slot (FullviewHeader §F3).
   * 셸은 밴드/타이틀/톤/닫기✕ 를 소유하고, 위젯 종속 액션만 이 두 slot 으로
   * 주입한다 ("셸은 스캐폴드"):
   *   - headerStartEl → 타이틀 옆(좌 flex-1 영역) — 프로젝트 pill.
   *   - headerEndEl   → 우측 클러스터(닫기✕ 왼쪽) — 상태 chip · End-session.
   * 레거시 모달 / 리스트 모드에서는 둘 다 null — 그 경로는 위젯 본문의
   * WidgetFullviewPanel 이 자체 헤더를 소유하므로 이 slot 을 쓰지 않는다.
   */
  headerStartEl?: HTMLElement | null;
  headerEndEl?: HTMLElement | null;
  /** 위젯 전체보기 열기 (카드 "전체 보기" 버튼 / deep-link). */
  openFullview: (key: string) => void;
  /** 사이드바에서 다른 위젯으로 전환 (모달 유지). */
  switchTo: (key: string) => void;
  /** 모달 닫기 (currentKey 는 보존). */
  close: () => void;
};

const FullviewShellContext = createContext<FullviewShellApi | null>(null);

export function FullviewShellProvider({
  value,
  children,
}: {
  value: FullviewShellApi;
  children: ReactNode;
}) {
  return (
    <FullviewShellContext.Provider value={value}>
      {children}
    </FullviewShellContext.Provider>
  );
}

// 위젯 본문이 쓰는 훅. 자기 key 가 현재 전체보기 대상인지 + slot 으로
// portal 하는 헬퍼 + close 를 돌려준다.
export function useFullview(widgetKey: string): {
  isCurrent: boolean;
  renderInSlot: (node: ReactNode) => ReactNode;
  /**
   * 풀뷰 V2 헤더 좌측(타이틀 옆)으로 portal — 프로젝트 pill.
   * headerStartEl 이 없는 경로(레거시 / 리스트)에서는 null 을 돌려주므로 위젯은
   * 결과를 그대로 렌더해도 안전하다.
   */
  renderInHeaderStart: (node: ReactNode) => ReactNode;
  /** 풀뷰 V2 헤더 우측(닫기✕ 왼쪽)으로 portal — 상태 chip · End-session. */
  renderInHeaderEnd: (node: ReactNode) => ReactNode;
  /** 이 위젯의 전체보기 modal 열기 (카드 안 완료 CTA / 진입점용). */
  openFullview: () => void;
  close: () => void;
} {
  const ctx = useContext(FullviewShellContext);
  const isCurrent = !!ctx && ctx.open && ctx.currentKey === widgetKey;
  const slotEl = ctx?.slotEl ?? null;
  const headerStartEl = ctx?.headerStartEl ?? null;
  const headerEndEl = ctx?.headerEndEl ?? null;
  const renderInSlot = (node: ReactNode): ReactNode =>
    isCurrent && slotEl ? createPortal(node, slotEl) : null;
  const renderInHeaderStart = (node: ReactNode): ReactNode =>
    isCurrent && headerStartEl ? createPortal(node, headerStartEl) : null;
  const renderInHeaderEnd = (node: ReactNode): ReactNode =>
    isCurrent && headerEndEl ? createPortal(node, headerEndEl) : null;
  return {
    isCurrent,
    renderInSlot,
    renderInHeaderStart,
    renderInHeaderEnd,
    openFullview: ctx ? () => ctx.openFullview(widgetKey) : () => {},
    close: ctx?.close ?? (() => {}),
  };
}

// 셸 chrome 형태 — WidgetFullviewPanel 이 닫기 × 노출 여부를 결정하는 데 쓴다.
// provider 밖에서는 'modal'(기본) 로 폴백해 기존 동작을 보존한다.
export function useFullviewChrome(): 'modal' | 'page' {
  const ctx = useContext(FullviewShellContext);
  return ctx?.chrome ?? 'modal';
}
