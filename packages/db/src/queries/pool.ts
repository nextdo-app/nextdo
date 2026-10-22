/**
 * Engine pool query (spec: domain/next-action-engine.md "Contract" —
 * "Pool contract (enforced by the packages/db pool query, trusted by the
 * engine)"):
 *
 * - only open, non-deleted candidates — done/deleted filtering is the
 *   pool's job, not the engine's;
 * - a `next_actions` row whose `project_id` points to a project that is
 *   not active (or deleted/missing) is not a candidate; projectless
 *   actions, CalendarActions (no projectId in v1) and today's HabitDays
 *   are unaffected;
 * - dependencyDone = the referenced action is done (or no dependency);
 * - the pool tags CalendarBlocks that originate from an open CalendarAction
 *   with its `sourceActionId`.
 *
 * The app fills in `context` and `now` to build the full `EngineInput`.
 * `now` is injected (device clock) — never read here.
 */
import {
  localDateKey,
  parseIso,
  toIso,
  type CalendarBlock,
  type CandidateAction,
  type CandidateBase,
} from '@nextdo/core';
import { normalizeNote, parseJson } from '../schema';
import type { NextdoDb } from '../types';

export interface EnginePool {
  /** open NextActions + today's open HabitDays + CalendarActions (today or starting soon). */
  actions: CandidateAction[];
  /** Hard schedule blocks — v1: all other open CalendarActions. */
  calendar: CalendarBlock[];
  /** All non-deleted projects (the engine checks `status` itself). */
  projects: { id: string; value: number; status: string }[];
}

const PREEMPTION_WINDOW_MS = 60 * 60_000;

const inFlightQueries = new WeakMap<object, Map<number, Promise<EnginePool>>>();

function getInFlightQuery(db: NextdoDb, timeMs: number): Promise<EnginePool> | undefined {
  return inFlightQueries.get(db)?.get(timeMs);
}

function setInFlightQuery(db: NextdoDb, timeMs: number, promise: Promise<EnginePool>): void {
  let map = inFlightQueries.get(db);
  if (!map) {
    map = new Map();
    inFlightQueries.set(db, map);
  }
  map.set(timeMs, promise);
  promise.finally(() => {
    map?.delete(timeMs);
  });
}

function baseFromRow(row: {
  id: string;
  title: string | null;
  context_ids: string | null;
  est_minutes: number | null;
  value: number | null;
  category: string | null;
  project_id?: string | null;
  depends_on_id?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  window_days?: string | null;
  due_date?: string | null;
  deadline?: string | null;
  snoozed_until?: string | null;
  last_snoozed_at?: string | null;
  consecutive_skips?: number | null;
  last_skipped_at?: string | null;
  created_at: string | null;
  note?: string | null;
}): CandidateBase {
  return {
    id: row.id,
    kind: 'next', // overwritten per candidate kind
    title: row.title ?? '',
    contextIds: parseJson<string[]>(row.context_ids, []),
    estMinutes: row.est_minutes ?? 0,
    value: (row.value ?? 3) as CandidateBase['value'],
    category: row.category as CandidateBase['category'],
    projectId: row.project_id ?? undefined,
    dependsOnId: row.depends_on_id ?? undefined,
    windowStart: row.window_start ?? undefined,
    windowEnd: row.window_end ?? undefined,
    windowDays: parseJson<number[] | null>(row.window_days, null) ?? undefined,
    dueDate: row.due_date ?? undefined,
    deadline: row.deadline ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    consecutiveSkips: row.consecutive_skips ?? 0,
    lastSkippedAt: row.last_skipped_at ?? undefined,
    dependencyDone: true, // resolved below
    createdAt: row.created_at ?? '',
    lastSnoozedAt: row.last_snoozed_at ?? undefined,
    note: normalizeNote(row.note) ?? undefined,
  };
}

/**
 * 1-based cycle day for a HabitDay row within its habit's challenge cycle
 * (null when the local date falls outside the cycle).
 *
 * Exported: shared by the pool query and the `startHabit` seeding
 * (queries/habits.ts) — the generation logic lives in ONE place.
 *
 * Uses calendar date arithmetic anchored at local noon rather than
 * fixed 86,400,000ms steps, preventing day drift across daylight saving
 * transitions (23/25 hour days) and timezone shifts.
 */
export function habitCycleDay(startedAt: string, cycleDays: number, localDate: string): number | null {
  const start = parseIso(startedAt);
  const year = start.getFullYear();
  const month = start.getMonth();
  const date = start.getDate();
  for (let day = 0; day < cycleDays; day++) {
    const current = new Date(year, month, date + day, 12, 0, 0);
    if (localDateKey(current) === localDate) {
      return day + 1;
    }
  }
  return null;
}

async function doQueryEnginePool(db: NextdoDb, now: Date): Promise<EnginePool> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = toIso(startOfToday);
  const soonIso = toIso(new Date(now.getTime() + PREEMPTION_WINDOW_MS));
  const todayKey = localDateKey(now);

  // Execute all pool-relevant queries concurrently with Promise.all to avoid
  // waterfall latency over the local database connection.
  const [
    doneNextRows,
    doneCalRows,
    doneHabitRows,
    projectRows,
    nextRows,
    dayRows,
    habitRows,
    calendarRows,
  ] = await Promise.all([
    db
      .selectFrom('next_actions')
      .select('id')
      .where('status', '=', 'done')
      .where('deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('calendar_actions')
      .select('id')
      .where('status', '=', 'done')
      .where('deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('habit_days')
      .select('id')
      .where('status', '=', 'done')
      .where('deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('projects')
      .select(['id', 'value', 'status'])
      .where('deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('next_actions')
      .selectAll()
      .where('status', '=', 'open')
      .where('deleted_at', 'is', null)
      .execute(),
    db
      .selectFrom('habit_days')
      .selectAll()
      .where('status', '=', 'open')
      .where('deleted_at', 'is', null)
      .where('local_date', '=', todayKey)
      .execute(),
    db.selectFrom('habits').selectAll().execute(),
    db
      .selectFrom('calendar_actions')
      .selectAll()
      .where('status', '=', 'open')
      .where('deleted_at', 'is', null)
      .execute(),
  ]);

  // Pool contract: ids of DONE (non-deleted) actions, per kind.
  const doneIds = new Set<string>();
  for (const row of doneNextRows) doneIds.add(row.id);
  for (const row of doneCalRows) doneIds.add(row.id);
  for (const row of doneHabitRows) doneIds.add(row.id);

  const resolveDependency = (dependsOnId?: string): boolean =>
    dependsOnId === undefined || doneIds.has(dependsOnId);

  const actions: CandidateAction[] = [];

  // Projects (all non-deleted; the engine applies the `active` check for
  // scoring). Loaded first: the same rows back the R5 pool filter below —
  // a NextAction bound to a non-active project is not a candidate.
  const activeProjectIds = new Set(
    projectRows.filter((row) => row.status === 'active').map((row) => row.id),
  );

  // 1. Open NextActions.
  for (const row of nextRows) {
    // Pool contract (R5): bound to a project that is not active (or
    // deleted/missing) → not a candidate. Projectless actions pass.
    if (row.project_id !== null && !activeProjectIds.has(row.project_id)) {
      continue;
    }
    actions.push({ ...baseFromRow(row), kind: 'next', dependencyDone: resolveDependency(row.depends_on_id ?? undefined) });
  }

  // 2. Today's open HabitDays (of live, active habits).
  const habitById = new Map(habitRows.map((habit) => [habit.id, habit]));
  for (const day of dayRows) {
    const habit = habitById.get(day.habit_id ?? '');
    if (habit === undefined || habit.deleted_at !== null || habit.status !== 'active') {
      continue;
    }
    // Pool contract (R5): bound to a project that is not active (or
    // deleted/missing) → not a candidate. Projectless habits pass.
    if (habit.project_id !== null && !activeProjectIds.has(habit.project_id)) {
      continue;
    }
    const cycleDays = habit.cycle_days ?? 0;
    const cycleDay = habitCycleDay(habit.started_at ?? '', cycleDays, day.local_date ?? '');
    if (cycleDay === null) {
      continue;
    }
    actions.push({
      ...baseFromRow({
        ...day,
        title: habit.action_title ?? null,
        context_ids: null,
        est_minutes: habit.est_minutes ?? null,
        value: habit.value ?? null,
        category: habit.category ?? null,
        project_id: habit.project_id ?? null,
        // The day row has no window columns — the window belongs to the
        // habit (spec: window-mismatch filter + habit-commitment signal).
        window_start: habit.window_start ?? null,
        window_end: habit.window_end ?? null,
        window_days: habit.window_days ?? null,
      }),
      kind: 'habit',
      habitId: habit.id,
      cycleDay,
      cycleDays,
    });
  }

  // 3. CalendarActions: today or starting soon (preemption window).
  const blocks: CalendarBlock[] = [];
  for (const row of calendarRows) {
    const startsAt = row.starts_at;
    if (startsAt === null) {
      continue;
    }
    // Hard schedule block for every open CalendarAction.
    const endMs = parseIso(startsAt).getTime() + (row.est_minutes ?? 0) * 60_000;
    blocks.push({ start: startsAt, end: toIso(new Date(endMs)), sourceActionId: row.id });
    // Candidate only within today / starting soon.
    if (startsAt < todayIso || startsAt > soonIso) {
      continue;
    }
    actions.push({ ...baseFromRow(row), kind: 'calendar', startsAt });
  }

  // The `projects` output keeps ALL non-deleted projects (including
  // non-active ones) — the engine's `project-importance` signal applies
  // the active check itself; R5 filtered the CANDIDATES above.
  const projects = projectRows.map((row) => ({
    id: row.id,
    value: row.value ?? 3,
    status: row.status ?? '',
  }));

  return { actions, calendar: blocks, projects };
}

export async function queryEnginePool(db: NextdoDb, now: Date): Promise<EnginePool> {
  const timeMs = now.getTime();
  const existing = getInFlightQuery(db, timeMs);
  if (existing !== undefined) {
    return existing;
  }
  const promise = doQueryEnginePool(db, now);
  setInFlightQuery(db, timeMs, promise);
  return promise;
}

/**
 * Watch-query builder for the engine pool (the app's `useActionPool` hook
 * wraps this in its `@powersync/react` watch-query subscription —
 * database-guidelines "@powersync/react boundary"; hook-guidelines "the
 * hook owns the subscription").
 *
 * It is an INVALIDATION TRIGGER, not a data query: it selects one row from
 * every table `queryEnginePool` reads, so any change to pool-relevant rows
 * re-fires the subscription. The subscription's result rows are unused —
 * the pool itself is always recomputed by `queryEnginePool`, which stays
 * the single home of pool logic (hook-guidelines: "Add the query in
 * packages/db/src/queries, then a thin hook around it").
 */
export function poolWatchQuery(db: NextdoDb) {
  return db
    .selectFrom('next_actions')
    .select('id')
    .union(db.selectFrom('habit_days').select('id'))
    .union(db.selectFrom('habits').select('id'))
    .union(db.selectFrom('calendar_actions').select('id'))
    .union(db.selectFrom('projects').select('id'));
}
