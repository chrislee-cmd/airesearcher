'use client';

/* ────────────────────────────────────────────────────────────────────
   useReducedMotion — OS 의 "동작 줄이기"(prefers-reduced-motion: reduce) 를
   구독하는 단일 소스. JS 로 모션을 켜고/끄는 분기(예: useCountUp 이 즉시 최종
   값으로 점프, 조건부 애니메이션 class)를 여기 한 곳에서 결정한다.

   CSS 유틸(.fade-in-up/.pop-in/... 및 프리미티브 press-scale)은 globals.css 의
   @media (prefers-reduced-motion: reduce) 로 이미 독립 존중하므로, 이 훅은
   "CSS 로 표현 못 하는 JS 애니메이션" 을 위한 것이다.

   SSR: 서버 스냅샷은 false(=모션 on) — 서버는 사용자 설정을 알 수 없으므로
   애니메이션이 정의된 기본 상태로 hydrate 하고, 클라이언트에서 matchMedia 값으로
   교정한다(useSyncExternalStore). matchMedia 미지원 환경은 false 로 안전 폴백.
   ──────────────────────────────────────────────────────────────────── */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  // Safari <14 는 addEventListener 대신 addListener 만 지원 — 둘 다 시도.
  if (mql.addEventListener) {
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  }
  mql.addListener(callback);
  return () => mql.removeListener(callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
