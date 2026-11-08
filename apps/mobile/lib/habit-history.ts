import {
  daysBetweenDateKeys,
  isHabitCatchUpAvailable,
  localDateKey,
  parseIso,
  type Habit,
  type HabitDay,
} from '@nextdo/core';
import { habitCycleDay } from '@nextdo/db';

export type HabitCellStatus =
  | 'done'
  | 'today'
  | 'catchup'
  | 'missed'
  | 'future'
  | 'unscheduled'
  | 'unrecorded';

export interface HabitGridDay {
  dayNumber: number;
  localDate: string;
  isToday: boolean;
  status: HabitCellStatus;
  day?: HabitDay;
}

/** Shared calendar view; retained rows outside this cycle remain history only. */
export function habitHistory(habit: Habit, days: HabitDay[], now: Date) {
  const todayKey = localDateKey(now);
  const start = parseIso(habit.startedAt);
  const daysByDate = new Map(days.map((day) => [day.localDate, day]));
  const grid: HabitGridDay[] = [];
  let today: HabitDay | null = null;
  let yesterday: HabitDay | null = null;

  for (let offset = 0; offset < habit.cycleDays; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 12);
    const dateKey = localDateKey(date);
    const day = daysByDate.get(dateKey);
    const scheduled = habit.windowDays === undefined || habit.windowDays.includes(date.getDay());
    const isToday = dateKey === todayKey;
    const canCatchUp = habit.status === 'active' && day?.status === 'open' && isHabitCatchUpAvailable(dateKey, now);
    let status: HabitCellStatus;
    if (day?.status === 'done') status = 'done';
    else if (!scheduled) status = 'unscheduled';
    else if (day === undefined) status = 'unrecorded';
    else if (isToday) status = 'today';
    else if (dateKey > todayKey) status = 'future';
    else if (canCatchUp) status = 'catchup';
    else status = 'missed';

    if (habit.status === 'active' && scheduled) {
      if (isToday) today = day ?? null;
      else if (canCatchUp) yesterday = day ?? null;
    }
    grid.push({ dayNumber: offset + 1, localDate: dateKey, isToday, status, day });
  }

  const gap = daysBetweenDateKeys(todayKey, localDateKey(start));
  return {
    cycleDay: habitCycleDay(habit.startedAt, habit.cycleDays, todayKey),
    doneCount: grid.filter((cell) => cell.status === 'done').length,
    startsInDays: gap > 0 ? gap : null,
    today,
    yesterday,
    extendedDays: Math.max(0, habit.cycleDays - 21),
    grid,
    priorCompletions: days
      .filter((day) => day.status === 'done' &&
        habitCycleDay(habit.startedAt, habit.cycleDays, day.localDate) === null)
      .sort((a, b) => b.localDate.localeCompare(a.localDate)),
  };
}
