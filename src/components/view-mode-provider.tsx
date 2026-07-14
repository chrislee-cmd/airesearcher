'use client';

/* ────────────────────────────────────────────────────────────────────
   ViewModeProvider — 캔버스 뷰 선호 (캔버스 ⇄ 리스트) 공유 채널.

   라이트/다크 테마처럼 유저가 선호 뷰를 고른다:
   - 'canvas' (현행) = 3×3 공간 보드 + pan/zoom, 전체보기는 모달.
   - 'list' (신규) = 캔버스 보드 없이 좌 사이드바 + 우 단일 위젯 상세
     (fullview 셸을 풀페이지로 재사용).

   헤더 토글(Topbar)과 캔버스 board(canvas-board)가 다른 컴포넌트라 이 provider
   가 (app) layout 에서 Topbar+page 를 감싸 상태를 공유한다. 초기값은 서버에서
   읽은 DB profiles.view_mode (initial prop).

   setMode = 클라 state 즉시 스왑(in-place, 라우트 이동/remount 없음 → 라이브
   세션 유지) + DB 영속(낙관적, 실패 시 이전 값 롤백). 미인증/공유 뷰엔
   provider 가 마운트되지 않으므로 useViewMode 는 default('canvas')로 no-op.
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ViewMode } from '@/lib/supabase/user';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';

type Ctx = {
  mode: ViewMode;
  setMode: (next: ViewMode) => void;
};

const ViewModeCtx = createContext<Ctx | null>(null);

export function ViewModeProvider({
  initialMode,
  children,
}: {
  initialMode: ViewMode;
  children: React.ReactNode;
}) {
  const [mode, setModeState] = useState<ViewMode>(initialMode);

  const setMode = useCallback((next: ViewMode) => {
    // 즉시 스왑 — 라우트 이동 없이 클라 state 만 바꿔 위젯 트리 remount 없이
    // 라이브 세션을 유지한다.
    setModeState(next);
    // DB 영속은 best-effort. 유저가 명시로 고른 뷰라, 저장이 실패해도(네트워크
    // blip · 마이그 미적용 등) 세션 내 선택은 유지하고 롤백하지 않는다 — 스냅백
    // 은 명시적 사용자 행동을 무시하는 나쁜 UX 다. 저장 성공 시 다음 방문·다른
    // 기기에서도 유지된다(실패 시 그 방문만 default 로 진입). 코드베이스의 다른
    // 선호 저장(probing research-context 등)과 동일한 무음 best-effort 패턴.
    void fetchWithAuth('/api/account/view-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ view_mode: next }),
    }).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(() => ({ mode, setMode }), [mode, setMode]);

  return <ViewModeCtx.Provider value={value}>{children}</ViewModeCtx.Provider>;
}

// provider 밖(공유/미인증 뷰)에서도 안전 — default 'canvas' + no-op setMode.
export function useViewMode(): Ctx {
  const ctx = useContext(ViewModeCtx);
  if (!ctx) {
    return { mode: 'canvas', setMode: () => {} };
  }
  return ctx;
}
