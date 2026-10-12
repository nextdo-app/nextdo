/**
 * Swipe-right-to-confirm for a list row (issue #17).
 *
 * The mobile counterpart of the keyboard loop: finishing an action is the
 * single most repeated gesture in the app, and it should not cost a tap on a
 * small 「完成」 button every time.
 *
 * Conflict avoidance is the whole design, because a gesture that fights the
 * scroll view or the system back-swipe is worse than no gesture at all:
 *
 *  - **Horizontal intent only.** The responder is claimed only once the
 *    finger has travelled clearly further sideways than vertically
 *    (`|dx| > 12` and `|dx| > 1.5·|dy|`). Until then the touch belongs to the
 *    parent `ScrollView`, so vertical scrolling is never stolen — not even
 *    for the first frame.
 *  - **Never from the screen edge.** A touch that starts within 24pt of the
 *    left edge is left alone, so the iOS system back-swipe keeps working.
 *  - **Past the threshold it commits, before it springs back.** Releasing
 *    under the threshold animates the row home and does nothing else, so a
 *    stray flick costs nothing.
 *
 * Built on RN's built-in `PanResponder` + `Animated` rather than
 * `react-native-gesture-handler` / `reanimated`: those are already in
 * `package.json` but are NOT wired into `babel.config.js`, and a swipe does
 * not justify turning on a worklet runtime (spec: app/component-guidelines
 * "no new dependencies without a reason").
 */
import { useCallback, useMemo, useRef } from 'react';
import { Animated, PanResponder, type PanResponderGestureState } from 'react-native';

/** Horizontal travel (pt) before the gesture is claimed from the scroll view. */
const CLAIM_DX = 12;
/** …and it must beat the vertical travel by this factor to be "horizontal". */
const HORIZONTAL_DOMINANCE = 1.5;
/** Travel (pt) that, on release, commits the action. */
export const COMMIT_DX = 96;
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

/** Did the release travel far (or fast) enough to commit? */
export function shouldCommit(dx: number, vx: number): boolean {
  // A fast flick counts even without the full distance — users flick, they
  // do not drag.
  return dx >= COMMIT_DX || (vx > 0.5 && dx >= COMMIT_DX / 2);
}

export interface SwipeRight {
  /** Spread onto the swipeable row. */
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** How far the row has been dragged, for `Animated.View`. */
  translateX: Animated.Value;
}

export function useSwipeRight(onCommit: () => void): SwipeRight {
  const translateX = useRef(new Animated.Value(0)).current;
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
          if (shouldCommit(gesture.dx, gesture.vx)) commitRef.current();
          settle(0);
        },
        onPanResponderTerminate: () => settle(0),
      }),
    [settle, translateX],
  );

  return { panHandlers: responder.panHandlers, translateX };
}
