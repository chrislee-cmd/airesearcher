'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasThemeSwitcher — 좌상단 floating pill. /canvas 한정.

   - 1행: theme chip 6개 (default / cyber / glass / swiss / sketch / pop)
     각 chip 미니 swatch (chrome + accent).
   - 2행: 현재 theme 의 font variant 5개 (각 폰트로 라벨 자체가 렌더 —
     한 눈에 비교 가능).
   - 클릭 = state 변경 + URL ?theme=...&font=... 동기화 (replaceState).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  CANVAS_THEMES,
  WIDGET_LAYOUTS,
  WIDGET_PANELS,
  WIDGET_INTERIORS,
  getThemeMeta,
  type CanvasTheme,
  type WidgetLayout,
  type WidgetPanel,
  type WidgetInterior,
} from '@/lib/canvas/themes';

// chip 미니 swatch — chrome / accent 색을 inline 표시.
const SWATCH: Record<CanvasTheme, { bg: string; accent: string; border: string }> = {
  default: { bg: '#FFFFFF',                                   accent: '#2EAADC', border: 'rgba(55,53,47,0.15)' },
  cyber:   { bg: '#0a0a12',                                   accent: '#00e0ff', border: '#2a2a3e' },
  glass:   { bg: 'linear-gradient(135deg,#c4b5fd,#fda4af)',   accent: '#ec4899', border: 'rgba(255,255,255,0.6)' },
  swiss:   { bg: '#FFFFFF',                                   accent: '#ff3b00', border: '#000000' },
  sketch:  { bg: '#fff7d6',                                   accent: '#d12c2c', border: '#2a2a2a' },
  pop:     { bg: '#ffd53d',                                   accent: '#ff5c8a', border: '#000000' },
};

type UrlState = {
  theme: CanvasTheme;
  fontKey: string;
  fontIsDefault: boolean;
  layout: WidgetLayout;
  panel: WidgetPanel;
  interior: WidgetInterior;
};

function syncUrl({ theme, fontKey, fontIsDefault, layout, panel, interior }: UrlState) {
  try {
    const url = new URL(window.location.href);
    if (theme === 'default') url.searchParams.delete('theme');
    else url.searchParams.set('theme', theme);
    if (fontIsDefault) url.searchParams.delete('font');
    else url.searchParams.set('font', fontKey);
    if (layout === 'classic') url.searchParams.delete('layout');
    else url.searchParams.set('layout', layout);
    if (panel === 'plain') url.searchParams.delete('panel');
    else url.searchParams.set('panel', panel);
    if (interior === 'default') url.searchParams.delete('interior');
    else url.searchParams.set('interior', interior);
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore (private mode / no history) */
  }
}

export function CanvasThemeSwitcher({
  theme,
  fontKey,
  layout,
  panel,
  interior,
  onChangeTheme,
  onChangeFont,
  onChangeLayout,
  onChangePanel,
  onChangeInterior,
}: {
  theme: CanvasTheme;
  fontKey: string;
  layout: WidgetLayout;
  panel: WidgetPanel;
  interior: WidgetInterior;
  onChangeTheme: (next: CanvasTheme) => void;
  onChangeFont: (next: string) => void;
  onChangeLayout: (next: WidgetLayout) => void;
  onChangePanel: (next: WidgetPanel) => void;
  onChangeInterior: (next: WidgetInterior) => void;
}) {
  const handleTheme = useCallback(
    (next: CanvasTheme) => {
      onChangeTheme(next);
      const defaultFont = getThemeMeta(next).fonts[0].key;
      syncUrl({ theme: next, fontKey: defaultFont, fontIsDefault: true, layout, panel, interior });
    },
    [onChangeTheme, layout, panel, interior],
  );

  const handleFont = useCallback(
    (next: string) => {
      onChangeFont(next);
      const isDefault = getThemeMeta(theme).fonts[0].key === next;
      syncUrl({ theme, fontKey: next, fontIsDefault: isDefault, layout, panel, interior });
    },
    [onChangeFont, theme, layout, panel, interior],
  );

  const handleLayout = useCallback(
    (next: WidgetLayout) => {
      onChangeLayout(next);
      const isDefaultFont = getThemeMeta(theme).fonts[0].key === fontKey;
      syncUrl({ theme, fontKey, fontIsDefault: isDefaultFont, layout: next, panel, interior });
    },
    [onChangeLayout, theme, fontKey, panel, interior],
  );

  const handlePanel = useCallback(
    (next: WidgetPanel) => {
      onChangePanel(next);
      const isDefaultFont = getThemeMeta(theme).fonts[0].key === fontKey;
      syncUrl({ theme, fontKey, fontIsDefault: isDefaultFont, layout, panel: next, interior });
    },
    [onChangePanel, theme, fontKey, layout, interior],
  );

  const handleInterior = useCallback(
    (next: WidgetInterior) => {
      onChangeInterior(next);
      const isDefaultFont = getThemeMeta(theme).fonts[0].key === fontKey;
      syncUrl({ theme, fontKey, fontIsDefault: isDefaultFont, layout, panel, interior: next });
    },
    [onChangeInterior, theme, fontKey, layout, panel],
  );

  const themeMeta = getThemeMeta(theme);

  return (
    <div className="pointer-events-none absolute left-6 top-6 z-fab">
      <div
        className="pointer-events-auto flex flex-col gap-1.5 px-1.5 py-1.5"
        style={{
          background: 'var(--canvas-chrome-bg)',
          border: '1px solid var(--canvas-chrome-border)',
          borderRadius: 'var(--canvas-chrome-radius)',
          boxShadow: 'var(--canvas-chrome-shadow)',
          backdropFilter: 'var(--canvas-backdrop)',
          WebkitBackdropFilter: 'var(--canvas-backdrop)' as unknown as string,
        }}
      >
        {/* row 1 — theme chips */}
        <div className="flex items-center gap-1">
          {CANVAS_THEMES.map((t) => {
            const active = t.key === theme;
            const sw = SWATCH[t.key];
            return (
              <Button
                key={t.key}
                variant="ghost"
                size="xs"
                onClick={() => handleTheme(t.key)}
                title={t.hint}
                className="!px-2"
                style={{
                  color: 'var(--canvas-chrome-text)',
                  fontWeight: active ? 700 : 500,
                  outline: active
                    ? '1.5px solid var(--canvas-selection-border)'
                    : 'none',
                  outlineOffset: '1px',
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-3.5 rounded-full"
                    style={{
                      background: sw.bg,
                      border: `1px solid ${sw.border}`,
                      boxShadow: `inset -3px -3px 0 ${sw.accent}`,
                    }}
                  />
                  {t.label}
                </span>
              </Button>
            );
          })}
        </div>

        {/* row 2 — font chips (현재 theme 의 5개 variant) — 라벨이 그 폰트로 렌더 */}
        <div
          className="flex items-center gap-1 border-t pt-1.5"
          style={{ borderColor: 'var(--canvas-chrome-border)' }}
        >
          <span
            className="px-1 text-xs tracking-[0.08em] uppercase"
            style={{ color: 'var(--canvas-card-mute)' }}
          >
            Font
          </span>
          {themeMeta.fonts.map((f) => {
            const active = f.key === fontKey;
            return (
              <Button
                key={f.key}
                variant="ghost"
                size="xs"
                onClick={() => handleFont(f.key)}
                title={f.label}
                className="!px-2"
                style={{
                  fontFamily: f.family,
                  color: 'var(--canvas-chrome-text)',
                  fontWeight: active ? 700 : 500,
                  outline: active
                    ? '1.5px solid var(--canvas-selection-border)'
                    : 'none',
                  outlineOffset: '1px',
                }}
              >
                {f.label}
              </Button>
            );
          })}
        </div>

        {/* row 3 — widget layout chips (5개) */}
        <div
          className="flex items-center gap-1 border-t pt-1.5"
          style={{ borderColor: 'var(--canvas-chrome-border)' }}
        >
          <span
            className="px-1 text-xs tracking-[0.08em] uppercase"
            style={{ color: 'var(--canvas-card-mute)' }}
          >
            Layout
          </span>
          {WIDGET_LAYOUTS.map((l) => {
            const active = l.key === layout;
            return (
              <Button
                key={l.key}
                variant="ghost"
                size="xs"
                onClick={() => handleLayout(l.key)}
                title={l.hint}
                className="!px-2"
                style={{
                  color: 'var(--canvas-chrome-text)',
                  fontWeight: active ? 700 : 500,
                  outline: active
                    ? '1.5px solid var(--canvas-selection-border)'
                    : 'none',
                  outlineOffset: '1px',
                }}
              >
                {l.label}
              </Button>
            );
          })}
        </div>

        {/* row 4 — widget panel (main + footer) chips (5개) */}
        <div
          className="flex items-center gap-1 border-t pt-1.5"
          style={{ borderColor: 'var(--canvas-chrome-border)' }}
        >
          <span
            className="px-1 text-xs tracking-[0.08em] uppercase"
            style={{ color: 'var(--canvas-card-mute)' }}
          >
            Panel
          </span>
          {WIDGET_PANELS.map((p) => {
            const active = p.key === panel;
            return (
              <Button
                key={p.key}
                variant="ghost"
                size="xs"
                onClick={() => handlePanel(p.key)}
                title={p.hint}
                className="!px-2"
                style={{
                  color: 'var(--canvas-chrome-text)',
                  fontWeight: active ? 700 : 500,
                  outline: active
                    ? '1.5px solid var(--canvas-selection-border)'
                    : 'none',
                  outlineOffset: '1px',
                }}
              >
                {p.label}
              </Button>
            );
          })}
        </div>

        {/* row 5 — widget interior (button/input 등 component) chips (5개) */}
        <div
          className="flex items-center gap-1 border-t pt-1.5"
          style={{ borderColor: 'var(--canvas-chrome-border)' }}
        >
          <span
            className="px-1 text-xs tracking-[0.08em] uppercase"
            style={{ color: 'var(--canvas-card-mute)' }}
          >
            Interior
          </span>
          {WIDGET_INTERIORS.map((i) => {
            const active = i.key === interior;
            return (
              <Button
                key={i.key}
                variant="ghost"
                size="xs"
                onClick={() => handleInterior(i.key)}
                title={i.hint}
                className="!px-2"
                style={{
                  color: 'var(--canvas-chrome-text)',
                  fontWeight: active ? 700 : 500,
                  outline: active
                    ? '1.5px solid var(--canvas-selection-border)'
                    : 'none',
                  outlineOffset: '1px',
                }}
              >
                {i.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div
        className="mt-2 max-w-[480px] text-xs"
        style={{ color: 'var(--canvas-card-mute)' }}
      >
        {themeMeta.hint}
      </div>
    </div>
  );
}
