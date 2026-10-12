/**
 * Eisenhower-quadrant classification (issue #16).
 *
 * The ranking engine already folded deadline pressure into a weighted score
 * (`deadline-urgency`, weight 1.0). That is enough to *nudge* ordering but
 * not to express the matrix the product asks for: with weights alone, a
 * value-5 action that has been waiting two weeks can still outrank a trivial
 * item that is due today. The quadrant is the coarse "which KIND of work
 * first" decision; the score stays the fine "which of these first" decision.
 * `recommend()` therefore sorts by quadrant, then by score.
 *
 * Deterministic by construction — `now` comes from `EngineInput`, never
 * `Date.now()`.
 */
import { deadlineStatus } from '../domain/deadline';
import type { CandidateAction, EngineInput } from './types';

/**
 * The four cells. Names are deliberately value-first ("important-urgent")
 * because `QUADRANT_ORDER` below is the PRD's priority list verbatim.
 */
export type Quadrant =
  /** 重要且紧急 — do it now. */
  | 'important-urgent'
  /** 不重要但紧急 — do it soon, or delegate. */
  | 'urgent'
  /** 重要但不紧急 — schedule it. */
  | 'important'
  /** 不重要且不紧急 — defer. */
  | 'neither';

/** Priority order; the array index IS the sort weight (lower first). */
export const QUADRANT_ORDER: readonly Quadrant[] = [
  'important-urgent',
  'urgent',
  'important',
  'neither',
];

/**
 * Value at or above which an action counts as 重要.
 *
 * Not a new invention: `rank.ts` already treats `value >= 3` as the bar for
 * emitting a "high value" reason. Reusing the same cut keeps the quadrant
 * and the "为什么是它" explanation from contradicting each other.
 */
export const IMPORTANT_VALUE_THRESHOLD = 3;

/**
 * Classify a candidate.
 *
 * "Urgent" means the deadline is already past or inside `DEADLINE_SOON_HOURS`
 * — the same window the UI paints as a warning chip, so the ordering a user
 * sees always matches the urgency they can see.
 *
 * No deadline ⇒ not urgent. That is the matrix working as intended, not a gap:
 * an action with no deadline has no time pressure, so it belongs in the
 * "schedule it" cell rather than competing for the current slot.
 */
export function quadrantOf(candidate: CandidateAction, input: EngineInput): Quadrant {
  const important = candidate.value >= IMPORTANT_VALUE_THRESHOLD;
  // A hard `deadline` wins over the soft `dueDate` when both are present —
  // same precedence `rank.ts` gives them.
  const status = deadlineStatus(candidate.deadline ?? candidate.dueDate, input.now);
  const urgent = status === 'overdue' || status === 'soon';
  if (important && urgent) return 'important-urgent';
  if (urgent) return 'urgent';
  if (important) return 'important';
  return 'neither';
}