/**
 * Swipe-right-to-reveal for a list row (issue #17, reworked by issue 27).
 *
 * The mobile counterpart of the keyboard loop: finishing an action is the
 * single most repeated gesture in the app, so the row gets a shortcut — but
 * a shortcut to the CONFIRMATION, never past it. Releasing past the
 * threshold parks the row open on its 完成 button; the action is completed
 * only when that button is pressed. A single swipe can therefore never
 * destroy work, which is the same promise issue 27 makes about a finished
 * focus session.
 *
 * On web the gesture is not registered at all (`panHandlers` is empty and
 * `enabled` is false): a mouse drag is not a swipe, it fights text selection
 * and the scrollbar, and the desktop build's completion path is a plain
 * click on the row's own 完成 button.
 *
 * Conflict avoidance is the rest of the design, because a gesture that
 * fights the scroll view or the system back-swipe is worse than no gesture:
 *
 *  - **Horizontal intent only.** The responder is claimed only once the
 *    finger has travelled clearly further sideways than vertically
 *    (`|dx| > 12` and `|dx| > 1.5·|dy|`). Until then the touch belongs to the
 *    parent `ScrollView`, so vertical scrolling is never stolen — not even
 *    for the first frame.
 *  - **Never from the screen edge.** A touch that starts within 24pt of the
 *    left edge is left alone, so the iOS system back-swipe keeps working.
 *  - **Past the threshold it parks open.** Releasing under the threshold
 *    animates the row home and does nothing else, so a stray flick costs
 *    nothing; releasing past it slides the row aside and stops.
 *
 * Built on RN's built-in `PanResponder` + `Animated` rather than
 * `react-native-gesture-handler` / `reanimated`: those are already in
 * `package.json` but are NOT wired into `babel.config.js`, and a swipe does
 * not justify turning on a worklet runtime (spec: app/component-guidelines
 * "no new dependencies without a reason").
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, type PanResponderGestureState } from 'react-native';

/** Horizontal travel (pt) before the gesture is claimed from the scroll view. */
const CLAIM_DX = 12;
/** …and it must beat the vertical travel by this factor to be "horizontal". */
const HORIZONTAL_DOMINANCE = 1.5;
/** Travel (pt) that, on release, parks the row open on its 完成 button. */
export const REVEAL_DX = 96;
/** Touches starting closer than this to the left edge belong to the system. */
const EDGE_GUARD = 24;
/** Furthest the row travels while held — past this it just stops. */
const MAX_DX = 128;

/** The part of a pan gesture the decisions below care about. */
export interface SwipeVector {
  dx: number;
  dy: number;
  vx: number;
}

/**
 * Should this touch be taken from the scroll view?
 *
 * Exported (rather than inlined) because these three rules ARE the conflict
 * avoidance — they are what stops the swipe from eating page scrolling and
 * the system back-swipe — and they are the part worth pinning down in tests.
 */
export function isHorizontalSwipe({ dx, dy }: SwipeVector): boolean {
  return Math.abs(dx) >= CLAIM_DX && Math.abs(dx) >= Math.abs(dy) * HORIZONTAL_DOMINANCE;
}

/** Touches from the left edge are the system's back-swipe, not ours. */
export function isSystemEdge(pageX: number): boolean {
  return pageX <= EDGE_GUARD;
}

/**
 * Did the release travel far (or fast) enough to park the row open?
 *
 * This is NOT "should the action be completed" — that is the button's tap,
 * and only that (issue 27). A fast flick counts without the full distance,
 * because users flick rather than drag.
 */
export function shouldReveal(dx: number, vx: number): boolean {
  return dx >= REVEAL_DX || (vx > 0.5 && dx >= REVEAL_DX / 2);
}

export interface SwipeReveal {
  /** Spread onto the swipeable row; empty on web. */
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** How far the row has been dragged, for `Animated.View`. */
  translateX: Animated.Value;
  /** True while the row is parked open and its 完成 button is live. */
  revealed: boolean;
  /** Complete — called by the exposed 完成 button only. */
  confirm: () => void;
  /** Close the exposed button without completing. */
  close: () => void;
  /** False on web: the row completes by click, never by gesture. */
  enabled: boolean;
}

export function useSwipeReveal(onCommit: () => void): SwipeReveal {
  const translateX = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);
  const enabled = Platform.OS !== 'web';
  // Same reason the keyboard hook reads its callback through a ref: a fresh
  // closure per render would rebuild the responder on every render.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const settle = useCallback(
    (toValue: number) => {
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }).start();
    },
    [translateX],
  );

  const close = useCallback(() => {
    setRevealed(false);
    settle(0);
  }, [settle]);

  const confirm = useCallback(() => {
    commitRef.current();
    close();
  }, [close]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed on MOVE, and only for a horizontal drag — this is what
        // keeps the ScrollView's own scrolling intact.
        onMoveShouldSetPanResponder: (_event, gesture) => isHorizontalSwipe(gesture),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          // The grant fires after the claim check; this is the re-check for
          // touches that began on the left edge.
          if (isSystemEdge(event.nativeEvent.pageX)) translateX.setValue(0);
        },
        onPanResponderMove: (_event, gesture) => {
          translateX.setValue(Math.max(0, Math.min(gesture.dx, MAX_DX)));
        },
        onPanResponderRelease: (_event, gesture: PanResponderGestureState) => {
          // Park open on a committed swipe; otherwise snap home silently.
          if (shouldReveal(gesture.dx, gesture.vx)) {
            setRevealed(true);
            settle(REVEAL_DX);
          } else {
            setRevealed(false);
            settle(0);
          }
        },
        onPanResponderTerminate: close,
      }),
    [close, settle, translateX],
  );

  return {
    // Web spreads nothing: no responder, so a mouse drag never moves the row.
    panHandlers: enabled ? responder.panHandlers : {},
    translateX,
    revealed,
    confirm,
    close,
    enabled,
  };
}