'use client';

/* ────────────────────────────────────────────────────────────────────
   CanvasToolbar — n8n / Figma 풍 하단 floating 컨트롤 패널.

   - 좌측: zoom out / 현재 % (클릭=reset) / zoom in
   - 중앙: Fit to screen
   - 우측: Reset layout (저장된 노드 위치 초기화)
   - theme: --canvas-chrome-* CSS variables 사용.
   ──────────────────────────────────────────────────────────────────── */

import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';

const CHROME_STYLE: React.CSSProperties = {
  background: 'var(--canvas-chrome-bg)',
  border: '1px solid var(--canvas-chrome-border)',
  borderRadius: 'var(--canvas-chrome-radius)',
  boxShadow: 'var(--canvas-chrome-shadow)',
  color: 'var(--canvas-chrome-text)',
  backdropFilter: 'var(--canvas-backdrop)',
  WebkitBackdropFilter: 'var(--canvas-backdrop)' as unknown as string,
};

export function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResetZoom,
  onResetLayout,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onResetZoom: () => void;
  onResetLayout: () => void;
}) {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 z-fab">
      <div
        className="pointer-events-auto flex items-center gap-1 px-1.5 py-1.5"
        style={CHROME_STYLE}
      >
        <IconButton
          variant="ghost"
          size="lg"
          aria-label="zoom out"
          title="Zoom out (휠 down)"
          onClick={onZoomOut}
          style={{ color: 'var(--canvas-chrome-text)' }}
        >
          <IconMinus />
        </IconButton>
        <Button
          variant="ghost"
          size="xs"
          onClick={onResetZoom}
          title="100% 로 리셋"
          className="min-w-[56px] tabular-nums"
          style={{ color: 'var(--canvas-chrome-text)' }}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <IconButton
          variant="ghost"
          size="lg"
          aria-label="zoom in"
          title="Zoom in (휠 up)"
          onClick={onZoomIn}
          style={{ color: 'var(--canvas-chrome-text)' }}
        >
          <IconPlus />
        </IconButton>
        <div className="mx-1 h-5 w-px" style={{ background: 'var(--canvas-chrome-border)' }} />
        <IconButton
          variant="ghost"
          size="lg"
          aria-label="fit to screen"
          title="Fit to screen"
          onClick={onFitToScreen}
          style={{ color: 'var(--canvas-chrome-text)' }}
        >
          <IconScan />
        </IconButton>
        <div className="mx-1 h-5 w-px" style={{ background: 'var(--canvas-chrome-border)' }} />
        <IconButton
          variant="ghost"
          size="lg"
          aria-label="reset layout"
          title="레이아웃 리셋 (기본 위치로)"
          onClick={onResetLayout}
          style={{ color: 'var(--canvas-chrome-text)' }}
        >
          <IconReset />
        </IconButton>
      </div>
      <div className="mt-2 text-center text-xs" style={{ color: 'var(--canvas-card-mute)' }}>
        space 누르고 드래그 = pan · 휠 = zoom · 헤더 드래그 = 위치 이동
      </div>
    </div>
  );
}

function IconMinus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconScan() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}
function IconReset() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
    </svg>
  );
}
