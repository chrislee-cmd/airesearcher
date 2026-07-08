'use client';

import {
  forwardRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';

// IME-safe commit guard. During a Korean/Japanese/Chinese IME composition the
// browser fires a synthetic Enter keydown to *finish* the current syllable —
// `nativeEvent.isComposing` is true (legacy Safari/IME: `keyCode === 229`).
// If a chip/token input commits on that Enter, it double-writes: the completed
// word PLUS the still-composing trailing syllable ("하이" → [하이][이]). Every
// Enter-to-commit text input MUST bail while this returns true.
//
// Exported so inputs that can't route through <ChipInput onCommit> (single
// submit-on-Enter forms, tag editors with custom Backspace/Escape handling)
// reuse the exact same guard instead of re-deriving it — the whole point of
// PR is that the guard lives in one place and can't be forgotten.
export function isComposingEnter(
  e: Pick<KeyboardEvent, 'nativeEvent' | 'keyCode'>,
): boolean {
  return e.nativeEvent?.isComposing || e.keyCode === 229;
}

// Shared <ChipInput> primitive — codifies the "extender" <input> that
// lives inside a chip container (the bare text field where users type
// the next chip value). Distinct from <Input> (form-styled with its own
// wrapper div) and <ChromeInput> (4px chrome border): ChipInput
// intentionally has NO own border / background — those belong to the
// parent chip container's focus-within frame.
//
// Audit observed 5 sites — desk-card-body keyword chip extender,
// translate-console glossary, widget-settings-modal, probing
// research-context, plus the /design-system catalog demo. New
// chip-style inputs (tag editors, multi-select drafts) should reuse
// this primitive rather than introducing another bare <input>.
//
// Layout: doesn't bake `flex-1` or min-width. Caller passes layout
// classes via className since the right values depend on the parent
// container.
//
// Cascade override: `[data-canvas-body] :is(input, ...)` in globals.css
// paints a 2px ink border + white bg + 6px radius + focus outline onto
// every bare <input> inside the canvas widget body. Without
// !important neutralization, the cascade wins over Tailwind utilities
// (attr+tag selector specificity beats class), drawing a second box
// stacked inside the parent's container frame. The `!*` prefixes below
// reclaim the bare-input contract.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  // IME-safe Enter commit, owned by the primitive so consumers can't forget the
  // composition guard. When set, ChipInput intercepts Enter (and comma when
  // `commitOnComma`) with `isComposingEnter` applied and emits the current
  // value. Consumers keep passing `onKeyDown` for other keys (Backspace to pop
  // the last chip, Escape to clear) — it still fires after the commit check.
  onCommit?: (value: string) => void;
  // Also treat "," as a commit key (email / comma-separated tag lists).
  commitOnComma?: boolean;
};

const BASE =
  '!border-0 !bg-transparent !rounded-none !shadow-none ' +
  '!px-0 !py-1 text-sm text-ink placeholder:text-mute-soft ' +
  'focus:!outline-none ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const ChipInput = forwardRef<HTMLInputElement, Props>(function ChipInput(
  { className, onCommit, commitOnComma, onKeyDown, ...rest },
  ref,
) {
  const cls = [BASE, className ?? ''].filter(Boolean).join(' ');
  const handleKeyDown = onCommit
    ? (e: KeyboardEvent<HTMLInputElement>) => {
        // Bail while the IME is mid-composition — this Enter only finishes the
        // syllable, it is not a commit intent (see isComposingEnter).
        if (
          !isComposingEnter(e) &&
          (e.key === 'Enter' || (commitOnComma && e.key === ','))
        ) {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        }
        onKeyDown?.(e);
      }
    : onKeyDown;
  return (
    <input ref={ref} className={cls} onKeyDown={handleKeyDown} {...rest} />
  );
});
