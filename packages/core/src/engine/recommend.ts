/**
 * recommend(input): EngineOutput — filter → calendar preemption → rank →
 * needsReclarify, with deterministic tie-breaks.
 *
 * Pure: no DB, no clock, no side effects; never mutates its input.
 */
import { hardFilter } from './filters';
import { scoreCandidate } from './rank';
import { QUADRANT_ORDER, quadrantOf } from './quadrant';
import { RECLARIFY_THRESHOLD } from './weights';
import type {
  CandidateAction,
  EngineInput,
  EngineOutput,
  Reason,
  ScoredAction,
} from './types';

interface Entry {
  candidate: CandidateAction;
  scored: ScoredAction;
  /** Index into `QUADRANT_ORDER` — the primary sort key (issue #16). */
  quadrantRank: number;
}

export function recommend(input: EngineInput): EngineOutput {
  const { ranked, preempted, filtered } = hardFilter(input);

  // Preempted calendar candidates go first, before ranking; they still
  // get a full score and are internally tie-broken for determinism.
  const preemptedEntries = preempted.map((c) => toEntry(c, input, true)).sort(compareEntries);
  const rankedEntries = ranked.map((c) => toEntry(c, input, false)).sort(compareEntries);
  const eligible: ScoredAction[] = [...preemptedEntries, ...rankedEntries].map(
    (entry) => entry.scored,
  );

  const needsReclarify = [...preempted, ...ranked]
    .filter((c) => c.consecutiveSkips >= RECLARIFY_THRESHOLD)
    .map((c) => ({ actionId: c.id, consecutiveSkips: c.consecutiveSkips }));

  return {
    recommended: eligible[0] ?? null,
    eligible,
    filtered,
    needsReclarify,
  };
}

function toEntry(candidate: CandidateAction, input: EngineInput, preempted: boolean): Entry {
  const s = scoreCandidate(candidate, input);
  const reasons: Reason[] = [...s.reasons, ...eligibilityReasons(candidate, preempted)];
  return {
    candidate,
    scored: { actionId: candidate.id, score: s.score, reasons },
    quadrantRank: QUADRANT_ORDER.indexOf(quadrantOf(candidate, input)),
  };
}

/**
 * Eligibility reasons record *why the action can run right now* (not
 * weighted). Emitted for every hard-filter survivor:
 * context-match (always — empty contextIds means "anywhere"),
 * window-open (only when window fields are set), time-fits (always true
 * for survivors), dependency-clear (always true for survivors),
 * calendar-preempt (preempted calendar candidates only).
 */
function eligibilityReasons(candidate: CandidateAction, preempted: boolean): Reason[] {
  const reasons: Reason[] = [];
  if (preempted) reasons.push({ type: 'eligibility', code: 'calendar-preempt' });
  reasons.push({
    type: 'eligibility',
    code: 'context-match',
    detail: candidate.contextIds.length === 0 ? 'anywhere' : candidate.contextIds.join(','),
  });
  if (
    candidate.windowStart !== undefined ||
    candidate.windowEnd !== undefined ||
    candidate.windowDays !== undefined
  ) {
    reasons.push({ type: 'eligibility', code: 'window-open' });
  }
  reasons.push({ type: 'eligibility', code: 'time-fits' });
  reasons.push({ type: 'eligibility', code: 'dependency-clear' });
  return reasons;
}

/**
 * Sort key order (issue #16):
 *   1. Eisenhower quadrant — 重要且紧急 → 不重要但紧急 → 重要但不紧急 → 都不
 *   2. score desc — within a quadrant, the existing weighted score decides
 *   3. deadline asc [nulls last], estMinutes asc, id asc — unchanged
 *
 * The quadrant outranks the score on purpose. `deadline-urgency` is one
 * weighted term, so on its own a high-value action that has been waiting
 * two weeks can still outrank something due today; the quadrant is what
 * makes the matrix's priority order actually hold. ISO datetime strings
 * compare chronologically.
 */
function compareEntries(a: Entry, b: Entry): number {
  if (a.quadrantRank !== b.quadrantRank) return a.quadrantRank - b.quadrantRank;
  if (b.scored.score !== a.scored.score) return b.scored.score - a.scored.score;

  const aDeadline = a.candidate.deadline;
  const bDeadline = b.candidate.deadline;
  if (aDeadline !== undefined && bDeadline !== undefined) {
    if (aDeadline !== bDeadline) return aDeadline < bDeadline ? -1 : 1;
  } else if (aDeadline === undefined && bDeadline !== undefined) {
    return 1; // nulls last
  } else if (aDeadline !== undefined && bDeadline === undefined) {
    return -1;
  }

  if (a.candidate.estMinutes !== b.candidate.estMinutes) {
    return a.candidate.estMinutes - b.candidate.estMinutes;
  }

  if (a.candidate.id !== b.candidate.id) return a.candidate.id < b.candidate.id ? -1 : 1;
  return 0;
}
