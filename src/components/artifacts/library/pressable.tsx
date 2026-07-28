'use client';

import type { KeyboardEvent, ReactNode } from 'react';

// Accessible non-native controls for the CD deliverables surface.
//
// Why not <Button>/<Checkbox> primitives? This is a design-led greenfield
// surface (rules 2c/2d): the CD comp specifies bespoke Memphis pill/tile
// treatments (2px vs 1.5px ink borders, shadow-memphis-sm vs -md, ink-fill
// checkbox with a white ✓) that diverge from the primitives' baked chrome.
// Overriding a primitive's variant colours via className is the documented
// Tailwind source-order trap (PROJECT.md §7.11). The DS native-control lint
// bans native <button>/<input>/<textarea> — it does NOT ban an accessible
// role="button"/role="checkbox" element, which is exactly what the CD .dc.html
// renders. So we reproduce the CD treatment faithfully on div/span with full
// role + tabIndex + keyboard support. The one real text field (search) still
// uses the <Input> primitive (chrome neutralised) since typing needs an input.

function activates(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
}

type PressableProps = {
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  children?: ReactNode;
};

// role="button" element. When disabled it drops its handlers and exposes
// aria-disabled so assistive tech reads it as inert (the caller supplies the
// disabled visual treatment).
export function Pressable({
  onPress,
  disabled = false,
  className = '',
  ariaLabel,
  title,
  children,
}: PressableProps) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      title={title}
      className={className}
      onClick={disabled ? undefined : onPress}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (activates(e)) {
                e.preventDefault();
                onPress?.();
              }
            }
      }
    >
      {children}
    </span>
  );
}

type SelectBoxProps = {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  // Visual size class + inner check glyph size. CD uses 14/15px in rows,
  // 17px in the bulk bar; callers pass the wrapper classes.
  boxClassName: string;
  glyphClassName?: string;
};

// role="checkbox" element. Reproduces the CD checkbox: ink border, radius 4,
// ink fill + white ✓ when checked (the <Checkbox> primitive fills with amore,
// which is the wrong identity here).
export function SelectBox({
  checked,
  onToggle,
  ariaLabel,
  boxClassName,
  glyphClassName = 'text-xs',
}: SelectBoxProps) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      tabIndex={0}
      className={[
        'inline-flex shrink-0 items-center justify-center border-ink text-paper',
        boxClassName,
        checked ? 'bg-ink' : 'bg-paper',
      ].join(' ')}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (activates(e)) {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
    >
      <span className={glyphClassName}>{checked ? '✓' : ''}</span>
    </span>
  );
}
