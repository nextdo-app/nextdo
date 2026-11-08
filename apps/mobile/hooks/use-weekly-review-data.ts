/**
 * Weekly-review data hook (design.md §4.5): the one-shot snapshot
 * (`buildWeeklyReviewSnapshot`) + the display lists (waiting follow-up
 * titles, the full someday list for keep/trash decisions, the next-7-day
 * schedule, and current project statuses for legal choices). Query-style like `useProjectActions`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import {
  buildWeeklyReviewSnapshot,
  listCalendarActions,
  listProjects,
  listSomedayMaybeItems,
  listWaitingForItems,
  wrapDb,
} from '@nextdo/db';
import {
  logger,
  type CalendarAction,
  type Project,
  type SomedayMaybeItem,
  type WaitingForItem,
  type WeeklyReviewSnapshot,
} from '@nextdo/core';
import { useAppClock } from './use-app-clock';

export interface WeeklyReviewData {
  snapshot: WeeklyReviewSnapshot;
  /** Waiting items — title lookup for `snapshot.waitingFollowUps`. */
  waiting: WaitingForItem[];
  /** The full someday list — the keep/trash decision rows. */
  somedays: SomedayMaybeItem[];
  /** Calendar actions — lookup for `snapshot.calendarNext7`. */
  calendar: CalendarAction[];
  /** Current project rows — defaults and allowed status transitions. */
  projects: Project[];
}

export interface UseWeeklyReviewDataResult {
  /** null until the first read settles. */
  data: WeeklyReviewData | null;
  error: string | null;
  /** Re-read after a mutation. */
  reload: () => void;
}

export function useWeeklyReviewData(): UseWeeklyReviewDataResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [snapshot, waiting, somedays, calendar, projects] = await Promise.all([
        buildWeeklyReviewSnapshot(db, now),
        listWaitingForItems(db),
        listSomedayMaybeItems(db),
        listCalendarActions(db),
        listProjects(db),
      ]);
      if (cancelled) return;
      const titles = Object.fromEntries([...projects, ...waiting, ...somedays, ...calendar]
        .filter((entry) => entry.title.trim()).map((entry) => [entry.id, entry.title]));
      setData({ snapshot: { ...snapshot, titles }, waiting, somedays, calendar, projects });
      setError(null);
    })().catch((err: unknown) => {
      if (cancelled) return;
      logger.error('weekly review snapshot failed', err instanceof Error ? err : new Error(String(err)));
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [db, now, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, reload };
}
