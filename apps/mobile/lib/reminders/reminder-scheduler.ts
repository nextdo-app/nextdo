/**
 * Reminder reconcile — the pure, platform-free decision function
 * (task 09-30 design §3). The unit-test core of the delivery layer.
 *
 * Compares the local `reminders` table (live `state='scheduled'` rows with
 * their resolved action titles — `listScheduledReminders` from
 * `@nextdo/db`) against the OS-side notification state (the set of pending
 * reminder ids, reported by the delivery adapter) and produces an IDEMPOTENT
 * set of operations:
 *
 * Native mode (iOS / Android — OS-persisted scheduling):
 *   1. Future row (fires_at > now) + not yet pending + has title → schedule;
 *   2. Orphan row (title null — the action row is gone) with a pending
 *      notification → cancel; the row itself stays in the DB untouched
 *      (v1 writes no fired/cancelled state here — R7);
 *   3. Pending id with no matching scheduled row (the business transaction
 *      already cancelled it) → cancel;
 *   4. Past rows (fires_at <= now) are never (re)scheduled — no late
 *      catch-up delivery (R7); if one still has a pending notification it
 *      is left to fire naturally (it is OS-persisted and will sound at its
 *      own time).
 *
 * Tauri mode (desktop — no native scheduling; in-session delivery through
 * the hook's 30 s tick):
 *   1. Row whose fires_at has passed within the trailing GRACE window, has
 *      a title, and was not already delivered this session → fire now;
 *   2. Rows past by more than GRACE → never delivered (missed while the
 *      app was closed — the Now screen shows the overdue action instead);
 *      future rows wait for the tick that crosses fires_at;
 *   3. No cancel operations (desktop has no OS-side pending state).
 *
 * Idempotency (AC7): re-running with the same inputs AFTER the operations
 * were applied (pendingIds now include the scheduled rows) yields empty
 * outputs — start/foreground churn never duplicates a schedule.
 *
 * No platform / React imports in this file — it is the unit-test subject.
 * `now` is injected (hook-guidelines: the engine receives the clock as a
 * parameter).
 */
import type { ScheduledReminderRow } from '@nextdo/db';

/** Which delivery semantics the reconcile applies. */
export type ReconcileMode = 'native' | 'tauri';

export interface ReconcileInput {
  mode: ReconcileMode;
  /**
   * The in-app notification master switch (issue #24 R2). `false` suppresses
   * delivery entirely: the pass withdraws every armed OS notification and
   * schedules / fires nothing, so the Settings toggle takes effect on the next
   * reconcile instead of waiting for the OS to drop a stale schedule.
   */
  enabled: boolean;
  /** The reconcile moment (injected — never read from the wall clock here). */
  now: Date;
  /** Live scheduled reminder rows, including orphans (title null). */
  rows: ScheduledReminderRow[];
  /** Reminder ids currently pending in the OS (tauri: always empty). */
  pendingIds: ReadonlySet<string>;
  /** Tauri-only: ids already delivered in this session (dedupe). */
  firedIds?: ReadonlySet<string>;
  /**
   * Tauri-only: the app session start. Kept on the contract for
   * diagnostics of fire-now decisions — the grace bound against `now`
   * already excludes rows that crossed fires_at long before the session
   * started (for those, `now - firesAt` exceeds GRACE).
   */
  sessionStart?: Date;
}

/** A row + its resolved title — the unit every adapter operation works on. */
export interface ReconcileItem {
  row: ScheduledReminderRow;
  /** The action's display title (always non-null — the rules filter). */
  title: string;
}

export interface ReconcileOutput {
  /** Future rows that need an OS-side schedule (native mode only). */
  toSchedule: ReconcileItem[];
  /** Pending ids without a matching live scheduled row. */
  toCancel: string[];
  /** Tauri-only: rows to deliver immediately in this tick. */
  toFireNow: ReconcileItem[];
}

/**
 * Desktop delivery grace window (design §3): a row whose fires_at has
 * passed by at most this is still delivered by the next tick (tick 30 s →
 * accuracy ±35 s, PRD R3); beyond it, delivery is skipped forever.
 */
export const TAURI_FIRE_GRACE_MS = 5 * 60 * 1000;

export function computeReconcile(input: ReconcileInput): ReconcileOutput {
  const { enabled, mode, now, rows, pendingIds, firedIds } = input;
  // R2: the in-app master switch is a hard gate ABOVE both modes. WITHDRAWING
  // (rather than merely skipping) is what makes the toggle immediate — the OS
  // still holds the schedules a previous pass created.
  if (!enabled) {
    return { toSchedule: [], toCancel: [...pendingIds], toFireNow: [] };
  }
  const nowMs = now.getTime();
  const toSchedule: ReconcileItem[] = [];
  const toCancel: string[] = [];
  const toFireNow: ReconcileItem[] = [];
  const rowIds = new Set<string>();

  for (const row of rows) {
    rowIds.add(row.id);
    const firesAtMs = new Date(row.firesAt).getTime();
    // A corrupt fires_at never schedules and never fires (defensive — the
    // column is written only by the db-layer transactions).
    if (Number.isNaN(firesAtMs)) continue;

    if (mode === 'native') {
      // Rule 1: future + titled + not pending → schedule.
      if (firesAtMs > nowMs && row.title !== null && !pendingIds.has(row.id)) {
        toSchedule.push({ row, title: row.title });
      }
      // Rule 2: orphan with a pending notification → cancel.
      if (row.title === null && pendingIds.has(row.id)) {
        toCancel.push(row.id);
      }
      // Rule 4: past rows fall through both branches — a pending
      // past-row notification is left to fire naturally, nothing else.
    } else {
      // Tauri rule 1: passed within the trailing grace window + titled +
      // not yet delivered this session → fire now. Past-beyond-grace and
      // future rows fall through (rule 2 / wait for the crossing tick).
      if (
        firesAtMs <= nowMs &&
        nowMs - firesAtMs <= TAURI_FIRE_GRACE_MS &&
        row.title !== null &&
        (firedIds === undefined || !firedIds.has(row.id))
      ) {
        toFireNow.push({ row, title: row.title });
      }
    }
  }

  if (mode === 'native') {
    // Rule 3: pending ids with no matching scheduled row → cancel.
    for (const id of pendingIds) {
      if (!rowIds.has(id)) toCancel.push(id);
    }
  }

  return { toSchedule, toCancel, toFireNow };
}
