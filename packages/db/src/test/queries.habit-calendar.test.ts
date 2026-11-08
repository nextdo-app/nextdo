import { localDateKey, toIso, type Habit } from '@nextdo/core';
import { completeAction } from '../queries/actions';
import { listHabitDays, listHabits, startHabit } from '../queries/habits';
import { openTestDb } from './query-helpers';

// Also run with TZ=America/New_York pnpm exec jest --runInBand queries.habit-calendar.test.ts.
it.each([
  [2026, 2, 1, 9], // Final date after the spring DST transition.
  [2026, 9, 25, 9], // Final date after the autumn DST transition.
  [2026, 11, 30, 4], // Year boundary.
])('completes on the final local calendar date (%i/%i/%i, %i days)', async (year, month, date, cycleDays) => {
  const start = new Date(year, month, date, 0);
  const lastDay = new Date(year, month, date + cycleDays - 1, 12);
  const { db, close } = await openTestDb(false, lastDay);
  try {
    const habit: Habit = {
      id: 'calendar-habit', title: '阅读', actionTitle: '读一页', estMinutes: 5, value: 3,
      cycleDays, startedAt: toIso(start), status: 'active',
      createdAt: toIso(start), updatedAt: toIso(start), deletedAt: null,
    };
    await startHabit(db, habit, lastDay);
    const days = await listHabitDays(db, { habitId: habit.id });
    expect(days).toHaveLength(cycleDays);
    const target = days.find((day) => day.localDate === localDateKey(lastDay))!;
    await completeAction(db, { actionKind: 'habit', actionId: target.id, now: lastDay });
    expect((await listHabits(db))[0]?.status).toBe('completed');
  } finally {
    await close();
  }
});
