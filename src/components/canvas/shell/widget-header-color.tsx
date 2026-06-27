'use client';

/* ────────────────────────────────────────────────────────────────────
   Widget header color — 위젯별 헤더 색 사용자 토글.

   - `useWidgetHeaderColor(widgetKey)` — localStorage 로 영속화 (hsl 문자열).
     null = 디폴트 (--canvas-card-header-bg = #ffd53d 노랑). 같은 탭
     안에서 다른 위젯의 색을 동시에 바꿔도 즉시 반영되도록 module-level
     listener set 으로 in-tab 변경을 notify. cross-tab 은 native `storage`
     이벤트.
   - `WidgetHeaderColorPicker` — palette IconButton trigger + hue 스펙트럼
     popover + "기본 노랑" 리셋. 헤더 우측 (state pill 옆) 에 둠.

   영속화 key: `widget-header-color:<widget.key>` — 위젯 type 별이라
   같은 위젯은 어디서 보든 같은 색.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';

const STORAGE_PREFIX = 'widget-header-color:';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((cb) => cb());
}

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', cb);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', cb);
    }
  };
}

function readColor(widgetKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + widgetKey);
  } catch {
    return null;
  }
}

export function useWidgetHeaderColor(widgetKey: string) {
  const color = useSyncExternalStore(
    subscribe,
    () => readColor(widgetKey),
    () => null,
  );

  function update(next: string | null) {
    if (typeof window === 'undefined') return;
    try {
      if (next === null) {
        window.localStorage.removeItem(STORAGE_PREFIX + widgetKey);
      } else {
        window.localStorage.setItem(STORAGE_PREFIX + widgetKey, next);
      }
    } catch {
      return;
    }
    notify();
  }

  return [color, update] as const;
}

export function WidgetHeaderColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function pickAt(clientX: number) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const hue = Math.round(ratio * 360);
    onChange(`hsl(${hue} 85% 82%)`);
  }

  const currentHue = parseHue(value);

  return (
    <div
      ref={rootRef}
      className="relative"
      // 드래그 핸들(=헤더) 이벤트 차단 — 위젯 dnd 가 picker 클릭에 안 따라옴.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <IconButton
        aria-label="헤더 색 선택"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
      >
        <PaletteGlyph />
      </IconButton>
      {open && (
        <div
          className="absolute right-0 top-full z-fab mt-2 p-3"
          style={{
            background: 'var(--canvas-card-bg)',
            border: '2.5px solid var(--canvas-card-border)',
            borderRadius: 6,
            boxShadow: '4px 4px 0 var(--canvas-card-border)',
            width: 220,
          }}
          role="dialog"
          aria-label="헤더 색 팔레트"
        >
          <div
            ref={barRef}
            className="cursor-crosshair touch-none"
            style={{
              height: 28,
              border: '2px solid var(--canvas-card-border)',
              borderRadius: 4,
              background:
                'linear-gradient(to right,' +
                'hsl(0 85% 82%),' +
                'hsl(60 85% 82%),' +
                'hsl(120 85% 82%),' +
                'hsl(180 85% 82%),' +
                'hsl(240 85% 82%),' +
                'hsl(300 85% 82%),' +
                'hsl(360 85% 82%))',
              position: 'relative',
            }}
            role="slider"
            aria-label="색상 (hue) 선택"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={currentHue ?? 0}
            tabIndex={0}
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              pickAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) pickAt(e.clientX);
            }}
            onPointerUp={(e) => {
              draggingRef.current = false;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                // pointer 가 이미 release 됨 — 무시.
              }
            }}
          >
            {currentHue !== null && <PickerIndicator hue={currentHue} />}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wider opacity-70">
              {value ? '사용자' : '기본'}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange(null)}
              leftIcon={
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    background: '#ffd53d',
                    border: '1.5px solid var(--canvas-card-border)',
                    borderRadius: 3,
                  }}
                />
              }
            >
              기본 노랑
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseHue(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/hsl\(\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const hue = Number(match[1]);
  return Number.isNaN(hue) ? null : hue;
}

function PickerIndicator({ hue }: { hue: number }) {
  const left = `${Math.max(0, Math.min(100, (hue / 360) * 100))}%`;
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        top: -2,
        bottom: -2,
        left,
        width: 3,
        background: 'var(--canvas-card-border)',
        transform: 'translateX(-50%)',
        borderRadius: 2,
      }}
    />
  );
}

function PaletteGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z" />
    </svg>
  );
}
