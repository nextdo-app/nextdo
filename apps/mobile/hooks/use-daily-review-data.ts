/**
 * Daily-review data hook (design.md §4.5): the one-shot snapshot
 * (`buildDailyReviewSnapshot`) + the display lists behind the snapshot's
 * id arrays (titles / times for stillOpen, schedule, waiting follow-ups,
 * repeated-skip rows, uncovered projects). Query-style like
 * `useProjectActions`: re-read on mount and after each mutation (the
 * screen calls `reload`). Personal-scale data — full lists, client-side
 * filtering by the snapshot's id sets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  buildDailyReviewSnapshot,
  listCalendarActions,
  listReviewCompletions,
  type ReviewCompletion,
  listHabitDays,
  listHabits,
  listNextActions,
  listProjects,
  listWaitingForItems,
  wrapDb,
} from '@nextdo/db';
import {
  logger,
  type CalendarAction,
  type DailyReviewSnapshot,
  type Habit,
  type HabitDay,
  type NextAction,
  type Project,
  type WaitingForItem,
} from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface DailyReviewData {
  snapshot: DailyReviewSnapshot;
  completed: ReviewCompletion[];
  /** Open next actions — title/est lookup for `snapshot.stillOpen`. */
  actions: NextAction[];
  /** Today's + tomorrow's schedule — lookup for `calendarToday/Tomorrow`. */
  calendar: CalendarAction[];
  /** Waiting items — title lookup for `waitingFollowUps`. */
  waiting: WaitingForItem[];
  /** All habit days — lookup for habit rows in `repeatedSkips`. */
  habitDays: HabitDay[];
  /** Habits — title lookup for the habit-day rows. */
  habits: Habit[];
  /** Projects — title lookup for `projectsMissingActions`. */
  projects: Project[];
}

export interface UseDailyReviewDataResult {
  /** null until the first read settles. */
  data: DailyReviewData | null;
  error: string | null;
  /** Re-read after a mutation (the snapshot's derived fields moved). */
  reload: () => void;
}

export function useDailyReviewData(): UseDailyReviewDataResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [data, setData] = useState<DailyReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [snapshot, actions, calendar, waiting, habitDays, habits, projects, completed] =
        await Promise.all([
          buildDailyReviewSnapshot(db, now),
          listNextActions(db).then((list) => list.filter((action) => action.status === 'open')),
          listCalendarActions(db),
          listWaitingForItems(db),
          listHabitDays(db),
          listHabits(db),
          listProjects(db),
          listReviewCompletions(db, now),
        ]);
      if (cancelled) return;
      const titles = Object.fromEntries([
        ...actions, ...calendar, ...waiting, ...projects, ...completed,
        ...habitDays.map((day) => ({ id: day.id, title: habits.find((habit) => habit.id === day.habitId)?.title ?? '' })),
      ].filter((entry) => entry.title.trim()).map((entry) => [entry.id, entry.title]));
      setData({ snapshot: { ...snapshot, titles }, actions, calendar, waiting, habitDays, habits, projects, completed });
      setError(null);
    })().catch((err: unknown) => {
      if (cancelled) return;
      logger.error('daily review snapshot failed', err instanceof Error ? err : new Error(String(err)));
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [db, now, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}
