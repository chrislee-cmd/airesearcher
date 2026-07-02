'use client';

/* ────────────────────────────────────────────────────────────────────
   useVisitedOnce — "설정을 한 번 거쳤는가" 를 per-id localStorage 로 기억하는
   훅. 통역/프로빙처럼 유효 default 는 있지만 "설정 버튼을 한 번 눌러 확인해야
   메인 CTA 가 활성화" 되어야 하는 온보딩 게이팅에 쓴다.

   반환: [visited, markVisited]
     - visited=false 인 동안 호출부가 CTA disabled + 설정 버튼 pulse.
     - 설정 모달을 열 때 markVisited() → 이후(재방문 세션 포함) 활성.

   SSR: 서버/hydrate 스냅샷은 false(=미방문, CTA disabled) 로 고정해 mismatch
   를 피하고, 클라이언트에서 localStorage 값으로 교정된다 (useSyncExternalStore).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState, useSyncExternalStore } from 'react';

function visitedKey(id: string) {
  return `settings-visited:${id}`;
}

// localStorage 는 이 훅 밖에서 바뀌지 않으므로 구독은 no-op.
function subscribe() {
  return () => {};
}

export function useVisitedOnce(id: string): [boolean, () => void] {
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(visitedKey(id)) === '1';
    } catch {
      // localStorage 접근 불가(private mode 등) — 게이팅을 걸지 않는다(활성).
      return true;
    }
  }, [id]);
  const persisted = useSyncExternalStore(subscribe, getSnapshot, () => false);
  // 이번 세션에서 방금 방문한 경우 즉시 반영.
  const [sessionVisited, setSessionVisited] = useState(false);
  const visited = persisted || sessionVisited;

  const markVisited = useCallback(() => {
    setSessionVisited(true);
    try {
      localStorage.setItem(visitedKey(id), '1');
    } catch {
      // 저장 실패해도 이번 세션 동안은 활성 유지.
    }
  }, [id]);

  return [visited, markVisited];
}
