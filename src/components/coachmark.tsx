'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type FeatureKey =
  | 'desk'
  | 'interviews'
  | 'reports'
  | 'quotes'
  | 'scheduler'
  | 'quant';

const STORAGE_KEY = (f: FeatureKey) => `coachmark:${f}:v1`;

type Props = {
  feature: FeatureKey;
};

// Top-of-page first-visit guide for feature pages. Dismisses permanently per
// feature once the user clicks "이해했어요" (localStorage). Versioned key
// (`:v1`) so we can re-introduce a refreshed coachmark by bumping it.
//
// We intentionally render a banner card rather than DOM-anchored tooltips:
// the existing pages already have an editorial, low-density layout, so a
// top-card with 2–3 numbered steps reads naturally and avoids the
// re-positioning fragility of tooltip libraries.
export function Coachmark({ feature }: Props) {
  const t = useTranslations(`Coachmark.${feature}`);
  const tCommon = useTranslations('Coachmark');
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY(feature));
      setHidden(seen === 'seen');
    } catch {
      setHidden(true); // SSR-safe / privacy mode → don't show
    }
  }, [feature]);

  if (hidden !== false) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY(feature), 'seen');
    } catch {
      // ignore — UI still dismisses
    }
    setHidden(true);
  }

  // Steps come back as a plain array via t.raw — the locale file stores them
  // as `steps: ["...", "..."]` so the order is editorial, not alphabetical.
  let steps: string[] = [];
  try {
    const raw = t.raw('steps');
    if (Array.isArray(raw)) steps = raw as string[];
  } catch {
    steps = [];
  }

  return (
    <section className="mb-6 border border-amore bg-paper p-5 [border-radius:4px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amore">
            {tCommon('eyebrow')}
          </p>
          <h2 className="mt-1.5 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
            {t('title')}
          </h2>
          {steps.length > 0 && (
            <ol className="mt-3 space-y-1.5 text-[12.5px] leading-[1.65] text-mute">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-mute-soft tabular-nums">
                    {i + 1}.
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-paper hover:bg-ink-2 [border-radius:4px]"
        >
          {tCommon('dismiss')}
        </button>
      </div>
    </section>
  );
}
