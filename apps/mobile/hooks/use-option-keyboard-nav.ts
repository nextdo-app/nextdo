/**
 * Roving keyboard selection for a vertical list of options (issue #17).
 *
 * The clarify flow is a chain of two-or-more-option questions asked over and
 * over during a weekly review, and clicking each answer is the slow part on a
 * desktop. Arrows + Enter turns the whole loop into three keystrokes.
 *
 * How it works — and why it is NOT a focus trap:
 *  - The options stay OUT of the tab order. Only the wrapper View carries
 *    `tabIndex={0}`, so Tab walks the page exactly as it did before; there is
 *    nothing to tab out of and nothing to trap.
 *  - The selected option is React state painted as a ring. DOM focus remains
 *    on the wrapper. That is why the ring is a className rather than
 *    `:focus-visible`: one focusable element cannot show a per-child ring,
 *    and moving real DOM focus between RN `Pressable`s would fight the
 *    browser's own focus management.
 *  - `resetKey` (the wizard's step) returns the selection to the first option
 *    AND pulls focus onto the wrapper, so answering a question hands the
 *    keyboard straight to the next one instead of stranding it on a button
 *    that no longer exists.
 *
 * Only the keys this list owns are intercepted. Everything else — Tab above
 * all — is left to the browser.
 *
 * `now`-style determinism does not apply here, but the hook IS web-only in
 * effect: a native build has no arrow keys, and `onKeyDown` is not a native
 * View prop, so the handler is registered only under `Platform.OS === 'web'`
 * (the desktop app ships the web build).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

/**
 * The visible focus ring. `!` (important) because the options carry their own
 * `border border-border` from the `secondary` variant, and a later class
 * attribute does not win a CSS cascade on its own.
 */
const RING_CLASS =
  '!border-2 !border-accent dark:!border-accent-dark';

/** Minimal shape of the DOM keyboard event we read. Declared locally so the
 *  hook does not depend on the DOM lib being in the tsconfig `lib` list. */
interface KeyEventLike {
  key: string;
  preventDefault: () => void;
}

export interface OptionKeyboardNav {
  /** Spread onto the View that wraps the options. */
  containerProps: ViewProps & {
    ref?: React.Ref<View>;
    onKeyDown?: (event: KeyEventLike) => void;
  };
  /** Extra className for option `index` — the ring when selected, '' else. */
  ringClass: (index: number) => string;
  /** True when the list can be driven by keyboard at all (web only). */
  enabled: boolean;
}

/**
 * @param count     how many options the list currently holds
 * @param onConfirm called with the selected index on Enter / Space
 * @param resetKey  changing this resets the selection to 0 and re-focuses;
 *                  pass the wizard step so each question starts at its first
 *                  answer
 */
export function useOptionKeyboardNav(
  count: number,
  onConfirm: (index: number) => void,
  resetKey: string,
): OptionKeyboardNav {
  const enabled = Platform.OS === 'web';
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<View | null>(null);
  // `onConfirm` is a fresh closure every render; reading it through a ref
  // keeps the key handler's identity stable so it is not re-bound mid-key.
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  // A shorter list must not leave the selection pointing past its end.
  useEffect(() => {
    setActiveIndex((current) => (current >= count ? 0 : current));
  }, [count]);

  useEffect(() => {
    setActiveIndex(0);
    if (!enabled) return;
    // Focus lands on the wrapper, so the very first arrow key already works.
    containerRef.current?.focus?.();
  }, [resetKey, enabled]);

  const onKeyDown = useCallback(
    (event: KeyEventLike) => {
      if (count === 0) return;
      const move = (delta: number) => {
        event.preventDefault();
        // Wrapping: the list is a loop, so 「下」 on the last option returns to
        // the first — the user never has to look at where they are.
        setActiveIndex((current) => (current + delta + count) % count);
      };
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          move(1);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(count - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          confirmRef.current(activeIndex);
          break;
        default:
          break;
      }
    },
    [activeIndex, count],
  );

  return {
    // `tabIndex`/`focusable` are real RN View props, so these are safe to
    // spread on native too; only the DOM key handler is web-only.
    containerProps: {
      ref: containerRef,
      focusable: enabled ? true : undefined,
      tabIndex: enabled ? 0 : undefined,
      ...(enabled ? { onKeyDown } : {}),
    },
    ringClass: (index: number) => (index === activeIndex && enabled ? RING_CLASS : ''),
    enabled,
  };
}