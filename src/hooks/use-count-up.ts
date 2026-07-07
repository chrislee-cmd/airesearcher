'use client';

/* ────────────────────────────────────────────────────────────────────
   useCountUp — 숫자가 이전 값에서 목표 값으로 부드럽게 세어 올라가/내려가는 훅.
   문서 수 · 크레딧 잔액 · "N / 240" 같은 카운터의 값 변화를 강조한다.

   동작:
     - target 이 바뀔 때마다 "지금 화면에 보이는 값"에서 새 target 까지
       requestAnimationFrame + easeOut 으로 애니메이션.
     - 최초 마운트는 target 을 즉시 표시(startFrom 을 주면 그 값에서 count-up).
     - reduced-motion(OS 동작 줄이기) 또는 durationMs<=0 이면 애니메이션 없이
       즉시 target — 접근성 존중(무애니메이션 = 즉시 최종 상태).

   반환은 정수(Math.round) — 카운터 표시는 대부분 정수. 소수 표시가 필요하면
   호출부에서 목표 스케일을 정수로 넘기고 나눠 표기.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';

type Options = {
  /** 애니메이션 길이(ms). 기본 600. */
  durationMs?: number;
  /** 최초 마운트 시 count-up 을 시작할 값. 생략 시 target 을 즉시 표시. */
  startFrom?: number;
};

// easeOutCubic — 빠르게 시작해 목표에 부드럽게 정착.
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, options: Options = {}): number {
  const { durationMs = 600, startFrom } = options;
  const reduced = useReducedMotion();

  const initial = startFrom ?? target;
  const [value, setValue] = useState<number>(initial);
  // 마지막으로 렌더된 실수값 — 애니메이션 도중 target 이 또 바뀌어도 현재 위치에서
  // 이어서 세도록 유지.
  const valueRef = useRef<number>(initial);

  useEffect(() => {
    const from = valueRef.current;

    if (reduced || durationMs <= 0 || from === target) {
      valueRef.current = target;
      setValue(target);
      return;
    }

    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      const next = from + (target - from) * easeOut(t);
      valueRef.current = next;
      setValue(next);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        valueRef.current = target;
        setValue(target);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // deps 는 target/durationMs/reduced 만 — 현재 위치는 valueRef(ref, 재실행
    // 유발 안 함)로 읽으므로 매 프레임이 아니라 target 변화에만 재시작한다.
  }, [target, durationMs, reduced]);

  return Math.round(value);
}
