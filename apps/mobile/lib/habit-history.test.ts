import { localDateKey, toIso, type Habit, type HabitDay } from '@nextdo/core';
import { habitHistory } from './habit-history';

const now = new Date(2026, 0, 5, 12); // Monday, across the year boundary.
const habit: Habit = {
  id: 'reading', title: '阅读', actionTitle: '读一页', estMinutes: 5, value: 3,
  cycleDays: 10, startedAt: toIso(new Date(2025, 11, 30, 0)), status: 'active',
  createdAt: toIso(now), updatedAt: toIso(now), deletedAt: null,
};

function day(date: string, status: HabitDay['status'] = 'open'): HabitDay {
  return {
    id: date, habitId: habit.id, localDate: date, status, consecutiveSkips: 0,
    createdAt: toIso(now), updatedAt: toIso(now), deletedAt: null,
  };
}

it('shows calendar dates and distinguishes completed, missed, catch-up, today, future and absent rows', () => {
  const rows = [day('20251230', 'done'), day('20260101'), day('20260104'), day('20260105'), day('20260106')];
  const result = habitHistory(habit, rows, now);
  expect(result.grid.map((cell) => [cell.localDate, cell.status])).toEqual([
    ['20251230', 'done'], ['20251231', 'unrecorded'], ['20260101', 'missed'],
    ['20260102', 'unrecorded'], ['20260103', 'unrecorded'], ['20260104', 'catchup'],
    ['20260105', 'today'], ['20260106', 'future'], ['20260107', 'unrecorded'], ['20260108', 'unrecorded'],
  ]);
  expect(result.today?.id).toBe('20260105');
  expect(result.yesterday?.id).toBe('20260104');
  expect(result.doneCount).toBe(1);
});

it('retains outside-cycle completions without counting or exposing stale actions after a start edit', () => {
  const result = habitHistory({ ...habit, startedAt: toIso(new Date(2026, 0, 6, 0)) }, [
    day('20251230', 'done'), day('20260104'), day('20260105'),
  ], now);
  expect(result).toMatchObject({ today: null, yesterday: null, doneCount: 0, startsInDays: 1 });
  expect(result.priorCompletions.map((row) => row.localDate)).toEqual(['20251230']);
});

it('does not offer excluded weekdays even when old rows remain after a schedule edit', () => {
  const result = habitHistory({ ...habit, windowDays: [2, 3, 4, 5] }, [
    day('20260103'), day('20260104'), day('20260105'),
  ], now);
  expect(result.today).toBeNull();
  expect(result.yesterday).toBeNull();
  expect(result.grid.filter((cell) => ['20260103', '20260104', '20260105'].includes(cell.localDate))
    .map((cell) => cell.status)).toEqual(['unscheduled', 'unscheduled', 'unscheduled']);
});

it.each(['completed', 'broken'] as const)('keeps %s histories read-only and retains actual completions', (status) => {
  const result = habitHistory({ ...habit, status }, [day('20260104'), day(localDateKey(now), 'done')], now);
  expect(result.today).toBeNull();
  expect(result.yesterday).toBeNull();
  expect(result.grid.some((cell) => cell.status === 'catchup')).toBe(false);
  expect(result.doneCount).toBe(1);
});
