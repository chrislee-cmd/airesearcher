'use client';

import { useEffect, useState } from 'react';

// Interview V2 — a generic sequential "sweep" driven by a run id. On each
// runId bump it ticks a cursor from 0 to `total`, one step per `stepMs`, so a
// UI can walk through a list (e.g. mark each uploaded file "읽는 중 → 읽음"
// when a search runs, showing every file is scanned once).
//
// All setState lives inside the interval callback so nothing runs
// synchronously in the effect body.

export type SequentialSweep = {
  // How many steps have completed so far (0..total).
  count: number;
  // A sweep is currently in flight.
  running: boolean;
  // At least one run has started (distinguishes the initial idle state).
  started: boolean;
  total: number;
};

export function useSequentialSweep(
  runId: number,
  total: number,
  stepMs = 220,
): SequentialSweep {
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (runId === 0 || total <= 0) return;
    let n = -1;
    const id = window.setInterval(() => {
      n += 1;
      if (n === 0) {
        setCount(0);
        setRunning(true);
        return;
      }
      setCount(n);
      if (n >= total) {
        window.clearInterval(id);
        setRunning(false);
      }
    }, stepMs);
    return () => window.clearInterval(id);
  }, [runId, total, stepMs]);

  return { count, running, started: runId > 0, total };
}
