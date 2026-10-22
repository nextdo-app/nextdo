/**
 * Engine contract (spec: domain/next-action-engine.md — verbatim shape).
 *
 * The engine never sees raw DB rows: the packages/db pool query builds
 * CandidateAction[] and resolves `dependencyDone`.
 *
 * The Candidate* family uses `interface` (it is extended); everything
 * else is a type alias (spec: project/conventions.md §TypeScript).
 */

export type CandidateKind = 'next' | 'habit' | 'calendar';

export interface CandidateBase {
  id: string;
  kind: CandidateKind;
  title: string;
  contextIds: string[];
  estMinutes: number;
  value: 1 | 2 | 3 | 4 | 5;
  category?: 'work' | 'health' | 'life' | 'other';
  projectId?: string;
  /** v1: at most one, direct. */
  dependsOnId?: string;
  /** "HH:mm", device-local. */
  windowStart?: string;
  /** "HH:mm", device-local. */
  windowEnd?: string;
  /** 0=Sunday … 6=Saturday, device-local; undefined = every day. */
  windowDays?: number[];
  /** ISO date (soft). */
  dueDate?: string;
  /** ISO datetime (exact moment; h = deadline − now). */
  deadline?: string;
  /** ISO datetime. */
  snoozedUntil?: string;
  consecutiveSkips: number;
  lastSkippedAt?: string;
  /** Resolved by the pool query (true when no dependency). */
  dependencyDone: boolean;
  /** ISO datetime. */
  createdAt: string;
  lastSnoozedAt?: string;
  /** The action's free-form note (issue #63) — carried through the pool so
   *  the Now list can show it without a second query, and so a reminder
   *  delivered through the system calendar writes it into the event. */
  note?: string;
}

export interface NextCandidate extends CandidateBase {
  kind: 'next';
}

export interface HabitCandidate extends CandidateBase {
  kind: 'habit';
  habitId: string;
  cycleDay: number;
  cycleDays: number;
}

export interface CalendarCandidate extends CandidateBase {
  kind: 'calendar';
  startsAt: string;
}

export type CandidateAction = NextCandidate | HabitCandidate | CalendarCandidate;

export type CalendarBlock = {
  /** ISO datetime. */
  start: string;
  /** ISO datetime. */
  end: string;
  /** Set when the block originates from an open CalendarAction. */
  sourceActionId?: string;
};

export type EngineContext = {
  /** Where the user is, e.g. ["computer", "office"]. */
  contextIds: string[];
  /** The time slot the user can give right now. */
  availableMinutes: number;
};

export type EngineInput = {
  /**
   * open NextActions + today's open HabitDays + CalendarActions (today or
   * starting soon) — per the pool contract: only open, non-deleted rows.
   */
  actions: CandidateAction[];
  /** Hard schedule blocks — v1: other open CalendarActions. */
  calendar: CalendarBlock[];
  projects: { id: string; value: number; status: string }[];
  context: EngineContext;
  /** INJECTED — never Date.now(). */
  now: Date;
};

export type ScoreCode =
  | 'deadline-urgency'
  | 'goal-value'
  | 'project-importance'
  | 'time-fit'
  | 'waiting-time'
  | 'habit-commitment'
  | 'health-protection';

export type EligibilityCode =
  | 'context-match'
  | 'window-open'
  | 'time-fits'
  | 'dependency-clear'
  | 'calendar-preempt';

export type ReasonCode = ScoreCode | EligibilityCode;

export type ReasonType = 'score' | 'eligibility';

export type Reason = {
  type: ReasonType;
  code: ReasonCode;
  detail?: string;
};

export type ScoredAction = {
  actionId: string;
  /** Deterministic; see the formula in the spec. */
  score: number;
  /** Non-empty for every eligible action. */
  reasons: Reason[];
};

export type FilterRuleId =
  | 'snoozed'
  | 'context-mismatch'
  | 'too-long'
  | 'window-mismatch'
  | 'dependency'
  | 'calendar-conflict';

export type FilteredAction = {
  actionId: string;
  rule: FilterRuleId;
};

export type EngineOutput = {
  /** The ONE action for the Now screen. */
  recommended: ScoredAction | null;
  /** Hard-filter survivors, ranked — backs "换一个". */
  eligible: ScoredAction[];
  /** Exclusions + rule — explainability/debug. */
  filtered: FilteredAction[];
  needsReclarify: { actionId: string; consecutiveSkips: number }[];
};
