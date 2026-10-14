/**
 * Status enums + allowed transitions per entity (spec: domain-model.md
 * "Lifecycle Assertions").
 *
 * `assertTransition` checks legality only — it throws
 * ValidationNextdoError on illegal jumps. Transitions with side effects
 * (CompletionRecord, cycle advance, re-clarify replace) are composed in
 * the packages/db query functions, atomically, one transaction per user
 * intent.
 */
import { ValidationNextdoError } from '../lib/errors';
import { toIso } from '../lib/time';
import type {
  ActionStatus,
  FocusSessionStatus,
  HabitDayStatus,
  HabitStatus,
  ProjectStatus,
  ReminderState,
} from './types';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'on-hold', 'done', 'dropped'];

export const ACTION_STATUSES: readonly ActionStatus[] = ['open', 'done'];

export const HABIT_STATUSES: readonly HabitStatus[] = ['active', 'completed', 'broken'];

export const REMINDER_STATES: readonly ReminderState[] = ['scheduled', 'fired', 'cancelled'];

export const FOCUS_SESSION_STATUSES: readonly FocusSessionStatus[] = [
  'active',
  'completed',
  'abandoned',
];

/** done/dropped are terminal. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  active: ['on-hold', 'done', 'dropped'],
  'on-hold': ['active', 'done', 'dropped'],
  done: [],
  dropped: [],
};

/**
 * `open → done` is the canonical complete transition; `done → open` is the
 * user-initiated RESTORE (issue 27 — 「已完成行动」窗口的「恢复为未完成」).
 * It is a deliberate exception to the "done is terminal" rule: a focus
 * session ending no longer completes the action (see queries/focus.ts), so a
 * mis-tap must be undoable. The restore transaction lives in
 * `queries/actions.ts` (`reopenAction`) and keeps every audit trail — the
 * CompletionRecord and the FocusSessions stay exactly as they were.
 */
export const ACTION_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  open: ['done'],
  done: ['open'],
};

/**
 * active → completed (last cycle day done); active → broken (a cycle day
 * missed); broken → active (user restarts the challenge);
 * completed → active (issue 27 — restoring a 打卡 from the 「已完成行动」 window
 * puts the challenge back in progress, because a day of it is open again).
 */
export const HABIT_TRANSITIONS: Record<HabitStatus, readonly HabitStatus[]> = {
  active: ['completed', 'broken'],
  broken: ['active'],
  completed: ['active'],
};

/**
 * HabitDay reuses the open/done lifecycle; `missed` is derived, not a status.
 *
 * `done → open` is the issue-27 restore, the exact mirror of
 * `ACTION_TRANSITIONS`: a 打卡 the user mis-tapped must be undoable from the
 * 「已完成行动」 window, which lists every day the user could complete from the
 * Now screen's pool.
 */
export const HABIT_DAY_TRANSITIONS: Record<HabitDayStatus, readonly HabitDayStatus[]> = {
  open: ['done'],
  done: ['open'],
};

export const REMINDER_TRANSITIONS: Record<ReminderState, readonly ReminderState[]> = {
  scheduled: ['fired', 'cancelled'],
  fired: [],
  cancelled: [],
};

export const FOCUS_SESSION_TRANSITIONS: Record<FocusSessionStatus, readonly FocusSessionStatus[]> =
  {
    active: ['completed', 'abandoned'],
    completed: [],
    abandoned: [],
  };

/**
 * Assert that `from → to` is a legal transition. `now` is part of the
 * contract signature (spec: assertTransition(entity, to, now)) and is
 * surfaced in the error for debuggability.
 */
export function assertTransition<S extends string>(
  transitions: Record<S, readonly S[]>,
  from: S,
  to: S,
  now: Date,
): void {
  const allowed = transitions[from];
  if (!allowed.includes(to)) {
    throw new ValidationNextdoError(
      `invalid-transition:${from}:${to}`,
      `Illegal transition ${from} → ${to} at ${toIso(now)}`,
    );
  }
}
