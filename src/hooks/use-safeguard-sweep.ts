'use client';

import { useEffect, useState } from 'react';

// Interview V2 — the per-search safeguard "sweep" shared by the trust panel
// (left) and the quality band under the search scope (right). Lifting it into
// one hook keeps a single interval driving both surfaces so they stay in sync.
//
// On each searchRunId bump, ticks a check across `total` safeguards one by one.
// All setState lives inside the interval callback so nothing runs
// synchronously in the effect body.

export type SafeguardSweep = {
  // How many safeguards have passed so far (0..total).
  checked: number;
  // A sweep is currently in flight.
  sweeping: boolean;
  // At least one search has run (distinguishes the initial idle state).
  started: boolean;
  total: number;
};

export function useSafeguardSweep(
  searchRunId: number,
  total: number,
  stepMs = 200,
): SafeguardSweep {
  const [checked, setChecked] = useState(0);
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    if (searchRunId === 0) return;
    let n = -1;
    const id = window.setInterval(() => {
      n += 1;
      if (n === 0) {
        setChecked(0);
        setSweeping(true);
        return;
      }
      setChecked(n);
      if (n >= total) {
        window.clearInterval(id);
        setSweeping(false);
      }
    }, stepMs);
    return () => window.clearInterval(id);
  }, [searchRunId, total, stepMs]);

  return { checked, sweeping, started: searchRunId > 0, total };
}
