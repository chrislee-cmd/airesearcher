'use client';

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

// Self-built headless menu primitive. Mirrors the SidebarAccount popover
// pattern (mousedown-outside + Esc) so visual + interaction language
// stays consistent. No Radix dependency — design tokens stay in our CSS,
// not in vendored component themes.
//
// Menu renders via createPortal into <body> with position:fixed so it
// escapes ancestor `overflow:hidden` / `transform` containers (canvas
// widget cards, modal bodies). z-overlay (=70) keeps it above modals
// (=50) and toasts (=60). Memphis pop tone matches Button / IconButton.

export type DropdownItem = {
  key: string;
  label: ReactNode;
  // Right-aligned monospace hint (e.g. ".docx").
  hint?: ReactNode;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
};

type Props = {
  trigger: (props: {
    open: boolean;
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    id: string;
  }) => ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
  /** Vertical placement relative to trigger. Default 'bottom'. */
  side?: 'top' | 'bottom';
  /** Min width of the popover. Default 160px. */
  minWidth?: number;
  /** Optional small label above the items. */
  label?: ReactNode;
};

export function DropdownMenu({
  trigger,
  items,
  align = 'start',
  side = 'bottom',
  minWidth = 160,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const triggerId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const updateRect = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    setAnchorRect(el.getBoundingClientRect());
  }, []);

  // Recompute anchor on open + on scroll/resize while open. position:fixed
  // means scrolling the page would otherwise leave the menu glued in place.
  useLayoutEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open, updateRect]);

  // Click outside — check BOTH wrapper (trigger) and menu (portal'd to body).
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open, close]);

  // Focus the active item as it changes (keyboard nav).
  useEffect(() => {
    if (!open) return;
    if (activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function onTriggerClick() {
    setOpen((v) => {
      if (v) setActiveIndex(-1);
      return !v;
    });
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const enabled = items
      .map((it, i) => (it.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (enabled.length === 0) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = enabled.indexOf(activeIndex);
      const next = enabled[(cur + 1 + enabled.length) % enabled.length];
      setActiveIndex(next ?? enabled[0]);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = enabled.indexOf(activeIndex);
      const prev = enabled[(cur - 1 + enabled.length) % enabled.length];
      setActiveIndex(prev ?? enabled[enabled.length - 1]);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(enabled[0]);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(enabled[enabled.length - 1]);
      return;
    }
  }

  async function onItemClick(item: DropdownItem) {
    if (item.disabled) return;
    close();
    await item.onSelect();
  }

  const menuStyle: CSSProperties = anchorRect
    ? (() => {
        const s: CSSProperties = {
          position: 'fixed',
          minWidth: Math.max(minWidth, anchorRect.width),
        };
        if (side === 'bottom') s.top = anchorRect.bottom + 4;
        else s.bottom = window.innerHeight - anchorRect.top + 4;
        if (align === 'start') s.left = anchorRect.left;
        else s.right = window.innerWidth - anchorRect.right;
        return s;
      })()
    : { position: 'fixed', visibility: 'hidden' };

  const portalTarget =
    typeof document !== 'undefined' ? document.body : null;

  return (
    <div className="relative inline-block" ref={wrapRef}>
      {trigger({
        open,
        onClick: onTriggerClick,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        id: triggerId,
      })}
      {open && portalTarget
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-labelledby={triggerId}
              onKeyDown={onMenuKeyDown}
              className="menu-in z-overlay border-[2px] border-ink bg-paper py-1 rounded-sm shadow-memphis-md"
              style={menuStyle}
            >
              {label ? (
                <div className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                  {label}
                </div>
              ) : null}
              {items.map((item, i) => (
                <button
                  key={item.key}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={i === activeIndex ? 0 : -1}
                  disabled={item.disabled}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => onItemClick(item)}
                  className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-sm transition-colors duration-[120ms] ${
                    item.disabled
                      ? 'cursor-not-allowed text-mute-soft/60'
                      : 'text-ink-2 hover:bg-line-soft/40 focus:bg-line-soft/40 focus:outline-none'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="shrink-0 font-mono text-xs-soft tabular-nums text-mute-soft">
                      {item.hint}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>,
            portalTarget,
          )
        : null}
    </div>
  );
}
