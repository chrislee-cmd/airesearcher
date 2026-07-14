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
  useRef,
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
  // 마지막으로 DB 에 커밋됐다고 아는 값 — PUT 실패 시 여기로 롤백. 초기값은
  // 서버가 읽어온 initialMode (= DB 현재값).
  const committedRef = useRef<ViewMode>(initialMode);

  const setMode = useCallback((next: ViewMode) => {
    // 낙관적 즉시 스왑 — UI 는 기다리지 않는다. 라우트 이동 없이 클라 state 만
    // 바꾸므로 위젯 트리는 remount 되지 않고 라이브 세션이 유지된다.
    setModeState(next);
    void (async () => {
      try {
        const res = await fetchWithAuth('/api/account/view-mode', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ view_mode: next }),
        });
        if (!res.ok) throw new Error(`view_mode_write_${res.status}`);
        committedRef.current = next;
      } catch {
        // 영속 실패 — 선호는 UX 이므로 조용히 이전 커밋 값으로 롤백.
        setModeState(committedRef.current);
      }
    })();
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
