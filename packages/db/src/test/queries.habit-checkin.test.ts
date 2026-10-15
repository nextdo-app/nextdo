/**
 * Habit 打卡窗口 + 顺延 + 提醒 (issue 30 / issue 32).
 *
 * Regression tests for the three behaviours these issues added:
 *   - issue 30: `completeAction` refuses a habit 打卡 outside its window,
 *     and `overrideWindow` is the only way through;
 *   - issue 32-A: `syncHabitCheckInReminders` builds the 打卡提醒 rows and
 *     converges when the window / preference / day state changes;
 *   - issue 32-B: `carryOverMissedHabitDays` extends the challenge by one
 *     day per permanently-missed day, idempotently.
 */
import { localDateKey, toIso, ulid, type Habit, type Value } from '@nextdo/core';
import { completeAction } from '../queries/actions';
import {
  DEFAULT_HABIT_REMINDER_OPTIONS,
  syncHabitCheckInReminders,
} from '../queries/habit-reminders';
import {
  carryOverMissedHabitDays,
  listHabitCarryOverCandidates,
  listHabits,
  listHabitDays,
  startHabit,
} from '../queries/habits';
import { openTestDb, type TestDb } from './query-helpers';

const DAY_MS = 86_400_000;
// 2026-09-21 is a Monday, 13:00 device-local (TZ=UTC in the test script).
const WINDOW_NOW = new Date('2026-09-21T13:00:00.000Z');
const YESTERDAY_KEY = localDateKey(new Date(WINDOW_NOW.getTime() - DAY_MS));

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(now: Date = WINDOW_NOW): Promise<TestDb> {
  env = await openTestDb(false, now);
  return env;
}

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  const midnight = new Date(WINDOW_NOW);
  midnight.setHours(0, 0, 0, 0);
  return {
    id: ulid(WINDOW_NOW),
    createdAt: toIso(WINDOW_NOW),
    updatedAt: toIso(WINDOW_NOW),
    deletedAt: null,
    title: '阅读',
    actionTitle: '阅读 30 min',
    estMinutes: 30,
    value: 3 as Value,
    cycleDays: 21,
    startedAt: toIso(midnight),
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Issue 30 — the 打卡 must land inside the habit's time window
// ---------------------------------------------------------------------------

describe('completeAction — habit window enforcement (issue 30)', () => {
  it('rejects a check-in after windowEnd and leaves the day open', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowStart: '08:00', windowEnd: '12:00' });
      const { today } = await startHabit(db, habit, WINDOW_NOW);
      expect(today).not.toBeNull();

      let err: unknown;
      try {
        await completeAction(db, {
          actionKind: 'habit',
          actionId: today!.id,
          now: WINDOW_NOW,
        });
      } catch (e) {
        err = e;
      }
      expect((err as { code?: string }).code).toBe('habit.checkin-outside-window');

      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days.find((d) => d.id === today!.id)?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('accepts a check-in inside the window', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowStart: '08:00', windowEnd: '20:00' });
      const { today } = await startHabit(db, habit, WINDOW_NOW);
      await completeAction(db, { actionKind: 'habit', actionId: today!.id, now: WINDOW_NOW });
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days.find((d) => d.id === today!.id)?.status).toBe('done');
    } finally {
      await close();
    }
  });

  it('overrideWindow is the confirmed path through', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowStart: '08:00', windowEnd: '12:00' });
      const { today } = await startHabit(db, habit, WINDOW_NOW);
      await completeAction(db, {
        actionKind: 'habit',
        actionId: today!.id,
        now: WINDOW_NOW,
        overrideWindow: true,
      });
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days.find((d) => d.id === today!.id)?.status).toBe('done');
    } finally {
      await close();
    }
  });

  it('an all-day habit is never blocked', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      const { today } = await startHabit(db, habit, WINDOW_NOW);
      await completeAction(db, { actionKind: 'habit', actionId: today!.id, now: WINDOW_NOW });
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days.find((d) => d.id === today!.id)?.status).toBe('done');
    } finally {
      await close();
    }
  });

  it('补卡 yesterday bypasses the window — that is the point of the catch-up', async () => {
    const { db, close } = await open();
    try {
      // Started yesterday so yesterday's day was seeded in the cycle.
      const yesterdayMidnight = new Date(WINDOW_NOW.getTime() - DAY_MS);
      yesterdayMidnight.setHours(0, 0, 0, 0);
      const habit = makeHabit({
        cycleDays: 3,
        startedAt: toIso(yesterdayMidnight),
        windowStart: '08:00',
        windowEnd: '12:00',
      });
      await startHabit(db, habit, WINDOW_NOW);
      const days = await listHabitDays(db, { habitId: habit.id });
      const yesterday = days.find((d) => d.localDate === YESTERDAY_KEY);
      expect(yesterday).toBeDefined();

      // No overrideWindow: yesterday's window closed hours ago.
      await completeAction(db, {
        actionKind: 'habit',
        actionId: yesterday!.id,
        now: WINDOW_NOW,
      });
      const after = await listHabitDays(db, { habitId: habit.id });
      expect(after.find((d) => d.id === yesterday!.id)?.status).toBe('done');
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Issue 32-A — the 打卡提醒 row
// ---------------------------------------------------------------------------

describe('syncHabitCheckInReminders (issue 32-A)', () => {
  async function remindersForHabit(db: TestDb['db'], habitId: string) {
    const days = await listHabitDays(db, { habitId });
    const dayIds = new Set(days.map((d) => d.id));
    const rows = await db
      .selectFrom('reminders')
      .selectAll()
      .where('action_kind', '=', 'habit')
      .execute();
    return rows.filter((r) => dayIds.has(r.action_id ?? ''));
  }

  it('a windowed habit is reminded at its own windowEnd', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit({ windowStart: '08:00', windowEnd: '20:00' });
      await startHabit(db, habit, WINDOW_NOW);
      const result = await syncHabitCheckInReminders(db, {
        habits: await listHabits(db),
        days: await listHabitDays(db),
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      expect(result.created).toBeGreaterThan(0);
      const rows = await remindersForHabit(db, habit.id);
      const today = rows.find((r) => r.fires_at === '2026-09-21T20:00:00.000Z');
      expect(today).toBeDefined();
      expect(today?.intensity).toBe('important');
      expect(today?.state).toBe('scheduled');
    } finally {
      await close();
    }
  });

  it('an all-day habit uses the configurable default (21:00)', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, WINDOW_NOW);
      await syncHabitCheckInReminders(db, {
        habits: await listHabits(db),
        days: await listHabitDays(db),
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const rows = await remindersForHabit(db, habit.id);
      expect(rows.some((r) => r.fires_at === '2026-09-21T21:00:00.000Z')).toBe(true);
    } finally {
      await close();
    }
  });

  it('changing the all-day time moves the row instead of duplicating it', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, WINDOW_NOW);
      const habits = await listHabits(db);
      const days = await listHabitDays(db);
      await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const second = await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: { ...DEFAULT_HABIT_REMINDER_OPTIONS, allDayReminderHhmm: '08:30' },
      });
      expect(second.created).toBe(1);
      expect(second.cancelled).toBeGreaterThan(0);

      const rows = await remindersForHabit(db, habit.id);
      const live = rows.filter((r) => r.state === 'scheduled');
      expect(live.some((r) => r.fires_at === '2026-09-22T08:30:00.000Z')).toBe(true);
      expect(live.some((r) => r.fires_at === '2026-09-21T21:00:00.000Z')).toBe(false);
    } finally {
      await close();
    }
  });

  it('is idempotent: a second identical pass creates nothing', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, WINDOW_NOW);
      const habits = await listHabits(db);
      const days = await listHabitDays(db);
      await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const again = await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      expect(again.created).toBe(0);
      expect(again.cancelled).toBe(0);
    } finally {
      await close();
    }
  });

  it('disabled: cancels every pending habit reminder', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      await startHabit(db, habit, WINDOW_NOW);
      const habits = await listHabits(db);
      const days = await listHabitDays(db);
      await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const off = await syncHabitCheckInReminders(db, {
        habits,
        days,
        now: WINDOW_NOW,
        options: { ...DEFAULT_HABIT_REMINDER_OPTIONS, enabled: false },
      });
      expect(off.cancelled).toBeGreaterThan(0);
      expect(off.created).toBe(0);
      const rows = await remindersForHabit(db, habit.id);
      expect(rows.filter((r) => r.state === 'scheduled')).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('a completed day gets no reminder', async () => {
    const { db, close } = await open();
    try {
      const habit = makeHabit();
      const { today } = await startHabit(db, habit, WINDOW_NOW);
      await completeAction(db, { actionKind: 'habit', actionId: today!.id, now: WINDOW_NOW });
      await syncHabitCheckInReminders(db, {
        habits: await listHabits(db),
        days: await listHabitDays(db),
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const rows = await remindersForHabit(db, habit.id);
      const doneId = today!.id;
      expect(rows.filter((r) => (r.action_id ?? '') === doneId && r.state === 'scheduled'))
        .toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('a day whose moment already passed gets no reminder', async () => {
    const { db, close } = await open();
    try {
      // windowEnd 12:00 has already gone by at 13:00.
      const habit = makeHabit({ windowStart: '08:00', windowEnd: '12:00' });
      await startHabit(db, habit, WINDOW_NOW);
      await syncHabitCheckInReminders(db, {
        habits: await listHabits(db),
        days: await listHabitDays(db),
        now: WINDOW_NOW,
        options: DEFAULT_HABIT_REMINDER_OPTIONS,
      });
      const days = await listHabitDays(db, { habitId: habit.id });
      const todayDay = days.find((d) => d.localDate === localDateKey(WINDOW_NOW));
      const rows = await remindersForHabit(db, habit.id);
      expect(rows.filter((r) => (r.action_id ?? '') === todayDay!.id)).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Issue 32-B — 顺延: a permanently-missed day buys a fresh challenge day
// ---------------------------------------------------------------------------

describe('carryOverMissedHabitDays (issue 32-B)', () => {
  /** A habit whose cycle began `daysAgo` days before `now`. */
  async function seedAgedHabit(db: TestDb['db'], daysAgo: number, cycleDays = 3): Promise<Habit> {
    const startedAt = new Date(WINDOW_NOW.getTime() - daysAgo * DAY_MS);
    startedAt.setHours(0, 0, 0, 0);
    const habit = makeHabit({ cycleDays, startedAt: toIso(startedAt) });
    await startHabit(db, habit, WINDOW_NOW);
    return habit;
  }

  it('does nothing when every past day is still 补卡-able', async () => {
    const { db, close } = await open();
    try {
      const habit = await seedAgedHabit(db, 1);
      expect(await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 })).toBe(3);
      const habits = await listHabits(db);
      expect(habits[0]?.cycleDays).toBe(3);
    } finally {
      await close();
    }
  });

  it('extends the cycle by one once a day ages out of the catch-up window', async () => {
    const { db, close } = await open();
    try {
      const habit = await seedAgedHabit(db, 2);
      const cycleDays = await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 });
      expect(cycleDays).toBe(4);
      const habits = await listHabits(db);
      expect(habits[0]?.cycleDays).toBe(4);
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days).toHaveLength(4);
    } finally {
      await close();
    }
  });

  it('is idempotent — a second pass does not compound the extension', async () => {
    const { db, close } = await open();
    try {
      const habit = await seedAgedHabit(db, 2);
      expect(await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 })).toBe(4);
      expect(await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 })).toBe(4);
      const days = await listHabitDays(db, { habitId: habit.id });
      expect(days).toHaveLength(4);
    } finally {
      await close();
    }
  });

  it('a completed day never extends the cycle', async () => {
    const { db, close } = await open();
    try {
      const habit = await seedAgedHabit(db, 2);
      const days = await listHabitDays(db, { habitId: habit.id });
      const oldest = days[0]!;
      await completeAction(db, {
        actionKind: 'habit',
        actionId: oldest.id,
        now: WINDOW_NOW,
        overrideWindow: true,
      });
      // Only the still-open 09-20 day is missed; 09-19 was completed.
      expect(await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 })).toBe(3);
    } finally {
      await close();
    }
  });

  it('listHabitCarryOverCandidates reports without writing', async () => {
    const { db, close } = await open();
    try {
      await seedAgedHabit(db, 2);
      const candidates = await listHabitCarryOverCandidates(db, WINDOW_NOW);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.extension).toBe(1);
      expect(candidates[0]?.cycleDays).toBe(3);
      const habits = await listHabits(db);
      expect(habits[0]?.cycleDays).toBe(3);
    } finally {
      await close();
    }
  });

  it('a completed habit is never extended', async () => {
    const { db, close } = await open();
    try {
      const habit = await seedAgedHabit(db, 2);
      await db
        .updateTable('habits')
        .set({ status: 'completed' })
        .where('id', '=', habit.id)
        .execute();
      expect(await carryOverMissedHabitDays(db, { habitId: habit.id, now: WINDOW_NOW, initialCycleDays: 3 })).toBe(3);
    } finally {
      await close();
    }
  });
});
