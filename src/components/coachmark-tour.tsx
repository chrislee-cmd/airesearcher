'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

type FeatureKey =
  | 'desk'
  | 'interviews'
  | 'reports'
  | 'quotes'
  | 'scheduler'
  | 'quant';

// Bumped from v1 (banner) — every user gets the spotlight tour once.
const STORAGE_KEY = (f: FeatureKey) => `coachmark:${f}:v2`;

// Step ids the locale file expects under Coachmark.<feature>.steps[<id>].
// The matching DOM element must carry data-coach="<feature>:<id>".
const STEPS: Record<FeatureKey, string[]> = {
  desk: ['region', 'keyword', 'sources', 'search'],
  interviews: ['upload', 'convert', 'analyze', 'export'],
  reports: ['upload', 'generate', 'preview'],
  quotes: ['upload', 'language', 'download'],
  scheduler: ['requirements', 'attendees', 'calendar'],
  quant: ['upload', 'pickers', 'modes'],
};

type Rect = { top: number; left: number; width: number; height: number };

const PADDING = 8;          // halo around the spotlighted element
const TOOLTIP_GAP = 14;     // px gap between target and tooltip
const TOOLTIP_W = 320;

export function CoachmarkTour({ feature }: { feature: FeatureKey }) {
  const t = useTranslations(`Coachmark.${feature}.steps`);
  const tCommon = useTranslations('Coachmark');
  const stepIds = STEPS[feature];

  // null = haven't decided yet (SSR-safe), 'hidden' = dismissed, number = active step
  const [active, setActive] = useState<number | 'hidden' | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  // Decide whether to start the tour. Runs once on mount.
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY(feature));
      setActive(seen === 'seen' ? 'hidden' : 0);
    } catch {
      setActive('hidden');
    }
  }, [feature]);

  // Locate the current step's target and measure it. Re-runs on step change,
  // window resize, and scroll. The :v2 dependency on `active` covers the
  // first measurement because that's when we know which step is active.
  const stepId = typeof active === 'number' ? stepIds[active] : null;
  const measure = useCallback(() => {
    if (typeof active !== 'number' || !stepId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-coach="${feature}:${stepId}"]`,
    );
    if (!el) {
      // Target isn't in the DOM (often a result panel that only renders
      // after a generation completes). Skip the step rather than freezing
      // the tour — last-step misses dismiss the tour entirely.
      setRect(null);
      if (active < stepIds.length - 1) {
        setActive(active + 1);
      } else {
        try {
          window.localStorage.setItem(STORAGE_KEY(feature), 'seen');
        } catch {
          // ignore
        }
        setActive('hidden');
      }
      return;
    }
    // Make sure the target is on screen so the spotlight isn't above the fold.
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 80) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
  }, [feature, stepId, active, stepIds.length]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (typeof active !== 'number') return;
    // Re-measure after the smooth-scroll settles, plus on continuous events.
    const tid = window.setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(tid);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, measure]);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY(feature), 'seen');
    } catch {
      // privacy-mode → still close the UI
    }
    setActive('hidden');
  }
  function next() {
    if (typeof active !== 'number') return;
    if (active < stepIds.length - 1) setActive(active + 1);
    else dismiss();
  }
  function prev() {
    if (typeof active !== 'number' || active <= 0) return;
    setActive(active - 1);
  }

  if (typeof active !== 'number' || !rect) {
    // While we look up the target, keep the page interactive — no overlay.
    return null;
  }

  // Tooltip placement.
  // - Default: below the target (small gap).
  // - Too close to bottom edge: flip above.
  // - Target too tall to fit either side without clipping (e.g. a full-page
  //   calendar): dock the tooltip to bottom-center of the viewport so it's
  //   always readable, even if it overlaps the spotlight slightly.
  const TOOLTIP_H = 220; // approximate; we just need a placement budget
  const fitsBelow = rect.top + rect.height + TOOLTIP_GAP + TOOLTIP_H + 16 < window.innerHeight;
  const fitsAbove = rect.top - TOOLTIP_GAP - TOOLTIP_H - 16 > 0;
  let tooltipTop: number;
  let tooltipLeft: number;
  if (fitsBelow) {
    tooltipTop = rect.top + rect.height + TOOLTIP_GAP;
    const raw = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    tooltipLeft = Math.max(16, Math.min(window.innerWidth - TOOLTIP_W - 16, raw));
  } else if (fitsAbove) {
    tooltipTop = rect.top - TOOLTIP_GAP - TOOLTIP_H;
    const raw = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    tooltipLeft = Math.max(16, Math.min(window.innerWidth - TOOLTIP_W - 16, raw));
  } else {
    // Docked fallback — target is taller than the viewport allows.
    tooltipTop = window.innerHeight - TOOLTIP_H - 24;
    tooltipLeft = window.innerWidth - TOOLTIP_W - 24;
  }

  return (
    // Outer container is pointer-events-none so the user can still scroll
    // the page (long forms, full-page calendar) while the tour is open.
    // Only the tooltip card opts back into pointer-events.
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label={tCommon('eyebrow')}
    >
      {/* Spotlight: a transparent rectangle whose enormous outset shadow
          dims everything else. Pure CSS — no SVG mask, no extra repaints. */}
      <div
        className="absolute transition-[top,left,width,height] duration-200 ease-out [border-radius:6px]"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 9999px rgba(15, 17, 21, 0.62)',
        }}
      />

      {/* Tooltip card */}
      <div
        className="pointer-events-auto absolute border border-line bg-paper p-5 [border-radius:4px] shadow-[0_8px_24px_rgba(15,17,21,0.18)]"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: TOOLTIP_W,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {tCommon('stepLabel', { current: active + 1, total: stepIds.length })}
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="text-[18px] leading-none text-mute-soft hover:text-ink-2"
            aria-label={tCommon('skip')}
          >
            ×
          </button>
        </div>
        <h3 className="mt-1.5 text-[14.5px] font-semibold tracking-[-0.005em] text-ink-2">
          {safeT(t, `${stepIds[active]}.title`)}
        </h3>
        <p className="mt-2 text-[12.5px] leading-[1.65] text-mute">
          {safeT(t, `${stepIds[active]}.body`)}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-[11px] text-mute-soft hover:text-ink-2"
          >
            {tCommon('skipAll')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={active === 0}
              className="border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-2 hover:text-amore disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
            >
              {tCommon('prev')}
            </button>
            <button
              type="button"
              onClick={next}
              autoFocus
              className="border border-ink bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-paper hover:bg-ink-2 [border-radius:4px]"
            >
              {active === stepIds.length - 1 ? tCommon('finish') : tCommon('next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// next-intl throws on missing keys; we'd rather fail soft so a missing
// translation doesn't crash the page during the tour.
function safeT(t: (k: string) => string, key: string): string {
  try {
    return t(key);
  } catch {
    return '';
  }
}
