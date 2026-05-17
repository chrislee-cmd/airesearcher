'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

// Self-built headless menu primitive. Mirrors the SidebarAccount popover
// pattern (mousedown-outside + Esc) so visual + interaction language
// stays consistent. No Radix dependency — design tokens stay in our CSS,
// not in vendored component themes.

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const triggerId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  // Click outside.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
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

  const horizontal = align === 'end' ? 'right-0' : 'left-0';
  const vertical = side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div className="relative inline-block" ref={wrapRef}>
      {trigger({
        open,
        onClick: onTriggerClick,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        id: triggerId,
      })}
      {open && (
        <div
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={`absolute ${horizontal} ${vertical} z-30 border border-line bg-paper py-1 [border-radius:14px]`}
          style={{ minWidth }}
        >
          {label ? (
            <div className="px-3 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft">
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
              className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[11.5px] transition-colors duration-[120ms] ${
                item.disabled
                  ? 'cursor-not-allowed text-mute-soft/60'
                  : 'text-ink-2 hover:bg-line-soft/40 focus:bg-line-soft/40 focus:outline-none'
              }`}
            >
              <span className="truncate">{item.label}</span>
              {item.hint ? (
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-mute-soft">
                  {item.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
