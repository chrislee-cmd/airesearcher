'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasThemeSwitcher — 좌상단 floating pill. /canvas 한정.

   - 6개 theme chip 한 줄 (default / cyber / glass / swiss / sketch / pop).
   - 클릭 = theme 변경 + URL ?theme=<key> 동기화 (replaceState — 새로고침
     시에도 마지막 선택 유지).
   - chip 자체 미니 swatch — 각 theme 의 chrome / accent 색을 작은 dot
     으로 표시 (한눈 비교).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CANVAS_THEMES, type CanvasTheme } from '@/lib/canvas/themes';

// chip 미니 swatch — chrome / accent 색을 inline 표시 (한눈 비교).
const SWATCH: Record<CanvasTheme, { bg: string; accent: string; border: string }> = {
  default: { bg: '#FFFFFF',                                   accent: '#2EAADC', border: 'rgba(55,53,47,0.15)' },
  cyber:   { bg: '#0a0a12',                                   accent: '#00e0ff', border: '#2a2a3e' },
  glass:   { bg: 'linear-gradient(135deg,#c4b5fd,#fda4af)',   accent: '#ec4899', border: 'rgba(255,255,255,0.6)' },
  swiss:   { bg: '#FFFFFF',                                   accent: '#ff3b00', border: '#000000' },
  sketch:  { bg: '#fff7d6',                                   accent: '#d12c2c', border: '#2a2a2a' },
  pop:     { bg: '#ffd53d',                                   accent: '#ff5c8a', border: '#000000' },
};

export function CanvasThemeSwitcher({
  theme,
  onChange,
}: {
  theme: CanvasTheme;
  onChange: (next: CanvasTheme) => void;
}) {
  const handle = useCallback(
    (next: CanvasTheme) => {
      onChange(next);
      try {
        const url = new URL(window.location.href);
        if (next === 'default') url.searchParams.delete('theme');
        else url.searchParams.set('theme', next);
        window.history.replaceState({}, '', url.toString());
      } catch {
        /* ignore (private mode / no history) */
      }
    },
    [onChange],
  );

  return (
    <div className="pointer-events-none absolute left-6 top-6 z-fab">
      <div
        className="pointer-events-auto flex items-center gap-1 px-1.5 py-1.5"
        style={{
          background: 'var(--canvas-chrome-bg)',
          border: '1px solid var(--canvas-chrome-border)',
          borderRadius: 'var(--canvas-chrome-radius)',
          boxShadow: 'var(--canvas-chrome-shadow)',
          backdropFilter: 'var(--canvas-backdrop)',
          WebkitBackdropFilter: 'var(--canvas-backdrop)' as unknown as string,
        }}
      >
        {CANVAS_THEMES.map((t) => {
          const active = t.key === theme;
          const sw = SWATCH[t.key];
          return (
            <Button
              key={t.key}
              variant="ghost"
              size="xs"
              onClick={() => handle(t.key)}
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
      <div
        className="mt-2 max-w-[280px] text-xs"
        style={{ color: 'var(--canvas-card-mute)' }}
      >
        {CANVAS_THEMES.find((t) => t.key === theme)?.hint}
      </div>
    </div>
  );
}
