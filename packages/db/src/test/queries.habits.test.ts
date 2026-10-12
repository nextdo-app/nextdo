/**
 * Query tests — Habits + HabitDays (spec: domain/domain-model.md "Habit
 * (+ HabitDay)"), including the start-challenge transaction and its
 * idempotent day seeding (invariant 5: deterministic
 * `hd-<habitId>-<YYYYMMDD>` ids).
 */
import {
  localDateKey,
  parseIso,
  toIso,
  ulid,
  type Habit,
  type Value,
} from '@nextdo/core';
import {
  addHabit,
  listHabits,
  listHabitDays,
  startHabit,
  trashHabit,
  updateHabit,
} from '../queries/habits';
import { habitCycleDay } from '../queries/pool';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId } from './fixtures';

const H = FIXTURE_IDS.habits;
const TODAY_KEY = localDateKey(FIXTURE_NOW);

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  env = await openTestDb(seed, now);
  return env;
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    title: '21 天习惯',
    actionTitle: '每天做',
    estMinutes: 15,
    value: 3 as Value,
    cycleDays: 21,
    startedAt: toIso(FIXTURE_NOW),
    status: 'active',
    ...overrides,
  };
}

describe('reads', () => {
  it('lists [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listHabits(db)).toEqual([]);
      expect(await listHabitDays(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the six seeded habits', async () => {
    const { db, close } = await open(true);
    try {
      expect(await listHabits(db)).toHaveLength(6);
    } finally {
      await close();
    }
  });

  it('listHabits filters by projectId', async () => {
    const { db, close } = await open();
    try {
      const p1Habit = makeHabit({ title: '项目1习惯', projectId: 'proj-1' });
      const p2Habit = makeHabit({ title: '项目2习惯', projectId: 'proj-2' });
      const projectlessHabit = makeHabit({ title: '无项目习惯' });
      await addHabit(db, p1Habit);
      await addHabit(db, p2Habit);
      await addHabit(db, projectlessHabit);

      const p1List = await listHabits(db, { projectId: 'proj-1' });
      expect(p1List).toHaveLength(1);
      expect(p1List[0]!.id).toBe(p1Habit.id);
      expect(p1List[0]!.projectId).toBe('proj-1');

      const p2List = await listHabits(db, { projectId: 'proj-2' });
      expect(p2List).toHaveLength(1);
      expect(p2List[0]!.id).toBe(p2Habit.id);

      const emptyList = await listHabits(db, { projectId: 'proj-non-existent' });
      expect(emptyList).toEqual([]);

      const all = await listHabits(db);
      expect(all).toHaveLength(3);
    } finally {
      await close();
    }
  });

  it('listHabitDays filters by habitId and localDate', async () => {
    const { db, close } = await open(true);
    try {
      expect(await listHabitDays(db)).toHaveLength(7);
      const mid = await listHabitDays(db, { habitId: H.mid });
      expect(mid).toHaveLength(2); // today (open) + yesterday (done)
      const today = await listHabitDays(db, { localDate: TODAY_KEY });
      expect(today).toHaveLength(5); // today, mid, last, weekdays, completed
      const yesterday = await listHabitDays(db, {
        localDate: localDateKey(new Date(FIXTURE_NOW.getTime() - 86_400_000)),
      });
      expect(yesterday).toHaveLength(2); // mid (done) + broken (open, derived "missed")
    } finally {
      await close();
    }
  });
});

describe('CRUD + transitions', () => {
  it('add: inserts a valid habit; rejects a non-positive cycleDays', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await addHabit(db, habit);
      expect(await listHabits(db)).toHaveLength(1);
      await expect(addHabit(db, makeHabit({ cycleDays: 0 }))).rejects.toMatchObject({
        code: 'validation.habit.cycleDays',
      });
    } finally {
      await close();
    }
  });

  it('update: completed is terminal (completed → active is illegal)', async () => {
    const { db, close } = await open(true);
    try {
      const completed = (await listHabits(db)).find((habit) => habit.id === H.completed);
      await expect(
        updateHabit(db, { ...(completed as Habit), status: 'active', updatedAt: toIso(FIXTURE_NOW) }),
      ).rejects.toMatchObject({ code: 'invalid-transition:completed:active' });
    } finally {
      await close();
    }
  });

  it('update: broken → active re-starts the challenge and (re-)seeds today', async () => {
    const { db, close } = await open(true);
    try {
      const broken = (await listHabits(db)).find((habit) => habit.id === H.broken);
      await updateHabit(db, { ...(broken as Habit), status: 'active', updatedAt: toIso(FIXTURE_NOW) });
      // today (09-21) is cycle day 6 of the 7-day cycle starting 09-16 → seeded
      const days = await listHabitDays(db, { habitId: H.broken, localDate: TODAY_KEY });
      expect(days).toHaveLength(1);
      expect(days[0]?.id).toBe(fixtureHabitDayId(H.broken, 0));
      expect(days[0]?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('trash: soft-deletes the habit; the day rows stay', async () => {
    const { db, close } = await open(true);
    try {
      await trashHabit(db, { id: H.today, now: FIXTURE_NOW });
      expect((await listHabits(db)).map((habit) => habit.id)).not.toContain(H.today);
      expect(await listHabitDays(db, { habitId: H.today })).toHaveLength(1);
      await expect(trashHabit(db, { id: H.today, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'habit.not-found',
      });
    } finally {
      await close();
    }
  });
});

describe('startHabit (the start-challenge transaction)', () => {
  it('inserts the habit and seeds today’s day in one transaction', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      const { habit: stored, today } = await startHabit(db, habit, FIXTURE_NOW);
      expect(stored.id).toBe(habit.id);
      expect(today).not.toBeNull();
      expect(today?.id).toBe(fixtureHabitDayId(habit.id, 0));
      expect(today?.habitId).toBe(habit.id);
      expect(today?.localDate).toBe(TODAY_KEY);
      expect(today?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('refuses a habit that is not active', async () => {
    const { db, close } = await open();
    try {
      await expect(
        startHabit(db, makeHabit({ status: 'broken' }), FIXTURE_NOW),
      ).rejects.toMatchObject({ code: 'habit.start-not-active' });
      expect(await listHabits(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('no day row when today is outside the weekday mask (habit row is stored)', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowDays: [0, 6] }); // weekend only — today is Monday
      const { today } = await startHabit(db, habit, FIXTURE_NOW);
      expect(today).toBeNull();
      expect(await listHabits(db)).toHaveLength(1);
      // The cycle is still seeded — only the masked days are skipped, so
      // today has no row while the weekends inside the cycle do.
      expect(await listHabitDays(db, { habitId: habit.id, localDate: TODAY_KEY })).toEqual([]);
      expect((await listHabitDays(db, { habitId: habit.id })).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('day generation is idempotent (re-starting never creates duplicates)', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, FIXTURE_NOW);
      // active → broken → active: the re-seed finds the existing day row.
      await updateHabit(db, { ...habit, status: 'broken', updatedAt: toIso(FIXTURE_NOW) });
      await updateHabit(db, { ...habit, status: 'active', updatedAt: toIso(FIXTURE_NOW) });
      const days = await listHabitDays(db, { habitId: habit.id, localDate: TODAY_KEY });
      expect(days).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('startHabit with a future start date', () => {
  /** Local midnight of `FIXTURE_NOW` plus `days` days — the shape the app
   *  writes after `checkHabitStartDate` accepts a picked start date. */
  function startDaysAhead(days: number): string {
    const anchor = new Date(FIXTURE_NOW);
    anchor.setDate(anchor.getDate() + days);
    anchor.setHours(0, 0, 0, 0);
    return toIso(anchor);
  }

  it('seeds the WHOLE cycle up front, so the days are waiting when it begins', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ startedAt: startDaysAhead(3) });
      const { today } = await startHabit(db, habit, FIXTURE_NOW);

      // Nothing for today — the challenge has not begun, which is an
      // ordinary outcome, not a failure.
      expect(today).toBeNull();

      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days).toHaveLength(21);
      expect(days[0]?.localDate).toBe(localDateKey(parseIso(habit.startedAt)));
      expect(days.every((day) => day.status === 'open')).toBe(true);
      // Every row is dated on or after the picked start date — nothing is
      // invented for the days before the challenge begins.
      expect(days.every((day) => day.localDate >= days[0]!.localDate)).toBe(true);
    } finally {
      await close();
    }
  });

  it('reports today when the challenge starts today', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ startedAt: startDaysAhead(0) });
      const { today } = await startHabit(db, habit, FIXTURE_NOW);

      expect(today?.localDate).toBe(TODAY_KEY);
      expect(habitCycleDay(habit.startedAt, habit.cycleDays, TODAY_KEY)).toBe(1);
      // The rest of the cycle is laid down too, not just today.
      expect(await listHabitDays(db, { habitId: habit.id })).toHaveLength(21);
    } finally {
      await close();
    }
  });

  it('seeds nothing when the cycle is entirely in the past', async () => {
    const { db, close } = await open();
    try {
      // The start-date rule (today or later) makes this unreachable from
      // the app, but a habit synced in from another client can still be in
      // this state — and every row it would create only reads as missed.
      const startedAt = startDaysAhead(0);
      const anchor = new Date(startedAt);
      anchor.setDate(anchor.getDate() - 25);
      const habit = makeHabit({ startedAt: toIso(anchor), cycleDays: 21 });
      const { today } = await startHabit(db, habit, FIXTURE_NOW);

      expect(today).toBeNull();
      expect(await listHabitDays(db, { habitId: habit.id })).toEqual([]);
    } finally {
      await close();
    }
  });

  it('re-seeding is idempotent — a restart never duplicates days', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ startedAt: startDaysAhead(3) });
      await startHabit(db, habit, FIXTURE_NOW);
      // broken → active re-runs the seed over the same cycle.
      await updateHabit(db, { ...habit, status: 'broken', updatedAt: toIso(FIXTURE_NOW) });
      await updateHabit(db, { ...habit, status: 'active', updatedAt: toIso(FIXTURE_NOW) });
      expect(await listHabitDays(db, { habitId: habit.id })).toHaveLength(21);
    } finally {
      await close();
    }
  });

  it('applies the weekday mask across the whole cycle, future days included', async () => {
    const { db, close } = await open();
    try {
      // weekend-only mask, starting Thu 2026-09-24 → the six weekend days
      // inside the 21-day cycle are the only rows written.
      const habit = makeHabit({ startedAt: startDaysAhead(3), windowDays: [0, 6] });
      const { today } = await startHabit(db, habit, FIXTURE_NOW);

      expect(today).toBeNull();
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days.map((day) => day.localDate).sort()).toEqual([
        localDateKey(new Date(2026, 8, 26)), // Sat
        localDateKey(new Date(2026, 8, 27)), // Sun
        localDateKey(new Date(2026, 9, 3)), // Sat
        localDateKey(new Date(2026, 9, 4)), // Sun
        localDateKey(new Date(2026, 9, 10)), // Sat
        localDateKey(new Date(2026, 9, 11)), // Sun
      ]);
    } finally {
      await close();
    }
  });
});

describe('habitCycleDay', () => {
  it('maps each consecutive calendar day to 1-based cycle index', () => {
    const startedAt = '2026-10-01T08:00:00.000Z';
    expect(habitCycleDay(startedAt, 21, '20261001')).toBe(1);
    expect(habitCycleDay(startedAt, 21, '20261002')).toBe(2);
    expect(habitCycleDay(startedAt, 21, '20261021')).toBe(21);
    expect(habitCycleDay(startedAt, 21, '20261022')).toBeNull();
    expect(habitCycleDay(startedAt, 21, '20260930')).toBeNull();
  });

  it('correctly handles month boundaries without day drift', () => {
    const startedAt = '2026-01-30T10:00:00.000Z';
    // 2026-01-30 (day 1), 2026-01-31 (day 2), 2026-02-01 (day 3)
    expect(habitCycleDay(startedAt, 5, '20260130')).toBe(1);
    expect(habitCycleDay(startedAt, 5, '20260131')).toBe(2);
    expect(habitCycleDay(startedAt, 5, '20260201')).toBe(3);
    expect(habitCycleDay(startedAt, 5, '20260202')).toBe(4);
    expect(habitCycleDay(startedAt, 5, '20260203')).toBe(5);
    expect(habitCycleDay(startedAt, 5, '20260204')).toBeNull();
  });

  it('preserves calendar day progression even when started near midnight', () => {
    // 23:45 local time
    const start = new Date(2026, 9, 1, 23, 45, 0);
    const startedAt = toIso(start);
    expect(habitCycleDay(startedAt, 3, localDateKey(new Date(2026, 9, 1)))).toBe(1);
    expect(habitCycleDay(startedAt, 3, localDateKey(new Date(2026, 9, 2)))).toBe(2);
    expect(habitCycleDay(startedAt, 3, localDateKey(new Date(2026, 9, 3)))).toBe(3);
    expect(habitCycleDay(startedAt, 3, localDateKey(new Date(2026, 9, 4)))).toBeNull();
  });

  it('updates habit fields and re-seeds days when startedAt or windowDays change', async () => {
    const { db, close } = await open();
    try {
      // Habit initially starts today, weekend only
      const habit = makeHabit({
        title: '原始习惯',
        actionTitle: '原始行动',
        estMinutes: 20,
        value: 2 as Value,
        startedAt: toIso(FIXTURE_NOW),
        windowDays: [0, 6],
      });
      await startHabit(db, habit, FIXTURE_NOW);
      const initialDays = await listHabitDays(db, { habitId: habit.id });

      // Update title, actionTitle, estMinutes, value, and expand windowDays to every day (undefined)
      const updated = await updateHabit(db, {
        ...habit,
        title: '新习惯名称',
        actionTitle: '新每日行动',
        estMinutes: 45,
        value: 5 as Value,
        windowDays: undefined,
        updatedAt: toIso(FIXTURE_NOW),
      });

      expect(updated.title).toBe('新习惯名称');
      expect(updated.estMinutes).toBe(45);
      expect(updated.value).toBe(5);

      // Verify db persistence
      const [fetched] = await listHabits(db);
      expect(fetched?.title).toBe('新习惯名称');
      expect(fetched?.actionTitle).toBe('新每日行动');
      expect(fetched?.estMinutes).toBe(45);
      expect(fetched?.value).toBe(5);

      // Since windowDays was removed (now every day), days count should expand to full 21 days
      const expandedDays = await listHabitDays(db, { habitId: habit.id });
      expect(expandedDays.length).toBe(21);
      expect(expandedDays.length).toBeGreaterThan(initialDays.length);
    } finally {
      await close();
    }
  });
});


