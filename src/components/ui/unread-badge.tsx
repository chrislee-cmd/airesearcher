import type { ReactNode } from 'react';

// Unread badge (빨간콩) — a Memphis-framed amore marker for a thread carrying an
// unseen participant message. Two shapes from one component:
//   • count omitted / 0  → a bare dot (boolean "has unread" — e.g. the broadcast
//     CTA). Preserves the original UnreadDot look exactly.
//   • count > 0          → a pill with the number, capped at 999 (per product:
//     "999 넘어가면 999", no "+"). Drives the recruiting chat-picker.
// Design tokens only (amore / ink / paper + memphis shadow) — no hardcoded
// color/radius, so it passes the canvas design-system lint.

const UNREAD_CAP = 999;

export function UnreadBadge({
  count,
  label,
}: {
  count?: number;
  label: ReactNode;
}): ReactNode {
  const n = count ?? 0;
  const ariaLabel = typeof label === 'string' ? label : undefined;

  if (n <= 0) {
    return (
      <span
        role="status"
        aria-label={ariaLabel}
        title={ariaLabel}
        className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-ink bg-amore shadow-memphis-2xs"
      />
    );
  }

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-pill border-2 border-ink bg-amore px-1.5 py-px font-mono text-xs font-bold tabular-nums text-paper shadow-memphis-2xs"
    >
      {n > UNREAD_CAP ? UNREAD_CAP : n}
    </span>
  );
}
