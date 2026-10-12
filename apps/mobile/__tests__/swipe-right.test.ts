/**
 * The swipe-to-complete gesture rules (issue #17).
 *
 * `useSwipeRight`'s value is almost entirely in what it REFUSES to claim:
 * a gesture that steals vertical scrolling or the iOS back-swipe is worse
 * than no gesture. So these tests pin the three decisions — horizontal
 * intent, edge guard, commit threshold — rather than the animation.
 */
import {
  COMMIT_DX,
  isHorizontalSwipe,
  isSystemEdge,
  shouldCommit,
} from '../hooks/use-swipe-right';

describe('swipe-right gesture rules', () => {
  describe('isHorizontalSwipe — claiming the touch from the scroll view', () => {
    it('claims a clearly sideways drag', () => {
      expect(isHorizontalSwipe({ dx: 40, dy: 4, vx: 0 })).toBe(true);
    });

    it('leaves a vertical drag to the ScrollView, however long it is', () => {
      // A long scroll that drifts sideways a little must still scroll.
      expect(isHorizontalSwipe({ dx: 20, dy: 300, vx: 0 })).toBe(false);
      expect(isHorizontalSwipe({ dx: 0, dy: 120, vx: 0 })).toBe(false);
    });

    it('ignores the sub-threshold jitter at the start of a touch', () => {
      expect(isHorizontalSwipe({ dx: 5, dy: 0, vx: 0 })).toBe(false);
    });

    it('requires horizontal dominance, so a diagonal is not a swipe', () => {
      // 40 across / 30 down: more than the 12pt floor, but not sideways.
      expect(isHorizontalSwipe({ dx: 40, dy: 30, vx: 0 })).toBe(false);
    });

    it('is direction-agnostic at this stage — leftward drags are judged the same', () => {
      expect(isHorizontalSwipe({ dx: -40, dy: 4, vx: 0 })).toBe(true);
    });
  });

  describe('isSystemEdge — leaving the iOS back-swipe alone', () => {
    it('treats a touch at the very left edge as the system\'s', () => {
      expect(isSystemEdge(0)).toBe(true);
      expect(isSystemEdge(12)).toBe(true);
    });

    it('leaves every other x to us', () => {
      // The guard covers the first 24pt; 25 is already ours.
      expect(isSystemEdge(25)).toBe(false);
      expect(isSystemEdge(200)).toBe(false);
    });
  });

  describe('shouldCommit — what a release actually does', () => {
    it('does nothing for a drag that stopped short', () => {
      expect(shouldCommit(20, 0)).toBe(false);
      expect(shouldCommit(COMMIT_DX - 1, 0)).toBe(false);
    });

    it('commits once the row is dragged past the threshold', () => {
      expect(shouldCommit(COMMIT_DX, 0)).toBe(true);
      expect(shouldCommit(200, 0)).toBe(true);
    });

    it('commits a fast flick that never reached the threshold', () => {
      // Half the distance but thrown, not dragged — still an intent to finish.
      expect(shouldCommit(COMMIT_DX / 2, 0.9)).toBe(true);
    });

    it('does not commit a slow half-hearted drag', () => {
      expect(shouldCommit(COMMIT_DX / 2, 0.1)).toBe(false);
    });

    it('never commits a leftward drag, however fast', () => {
      expect(shouldCommit(-300, 2)).toBe(false);
    });
  });
});
