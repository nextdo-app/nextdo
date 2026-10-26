/**
 * The Settings screen's calendar-target handle (Google / iCloud / local).
 *
 * Why a picker at all: the OS calendar database already holds whatever the
 * user signed into — their Google calendars, their iCloud calendars, local
 * ones. Writing into the Nextdo-owned calendar keeps those day views empty,
 * so a reminder the user asked for never shows up where they actually look.
 * Letting them name the target is the whole feature; Nextdo adds no account
 * flow of its own and never talks to Google or Apple directly.
 *
 * The choice is device-local (see `lib/calendar-sync/store.ts`): a calendar id
 * names a row in THIS device's system database, so syncing it would point
 * another device at an id that means nothing there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCalendarPermission,
  isCalendarSupported,
  listCalendars,
  type CalendarPermission,
  type WritableCalendar,
} from '@/lib/calendar-sync';
import { loadCalendarSyncState, saveCalendarSyncState } from '@/lib/calendar-sync/store';
import { logger } from '@nextdo/core';

export interface UseCalendarTargetResult {
  /** Calendars the user can write into; read-only ones are filtered out. */
  calendars: WritableCalendar[];
  /** The picked calendar id, or null for "Nextdo default". */
  preferredCalendarId: string | null;
  /** The OS access state — the list is only readable once granted. */
  permission: CalendarPermission;
  /** True once the list has been read at least once. */
  loaded: boolean;
  /** Persist a choice; null restores the Nextdo default. */
  selectCalendar: (calendarId: string | null) => Promise<void>;
  /** Re-read access + the calendar list (after the user grants access). */
  refresh: () => Promise<void>;
}

export function useCalendarTarget(): UseCalendarTargetResult {
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const [preferredCalendarId, setPreferredCalendarId] = useState<string | null>(null);
  const [permission, setPermission] = useState<CalendarPermission>('undetermined');
  const [loaded, setLoaded] = useState(false);
  const disposedRef = useRef(false);

  // Reading the list needs calendar access, and access is granted from the
  // Settings switch — so this must be callable again, not just an effect.
  const refresh = useCallback(async (): Promise<void> => {
    if (!(await isCalendarSupported())) {
      if (disposedRef.current) return;
      setPermission('denied');
      setLoaded(true);
      return;
    }
    const state = await getCalendarPermission();
    if (disposedRef.current) return;
    setPermission(state);
    if (state !== 'granted') {
      // An unread list is a normal answer here (the user never granted
      // access), not an error to surface.
      setLoaded(true);
      return;
    }
    const available = await listCalendars();
    if (disposedRef.current) return;
    setCalendars(available.filter((calendar) => calendar.allowsModifications));
    setLoaded(true);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    void loadCalendarSyncState().then((state) => {
      if (!disposedRef.current) setPreferredCalendarId(state.preferredCalendarId);
    });
    void refresh().catch((error: unknown) => {
      logger.warn('reading the calendar list failed', toError(error));
      if (!disposedRef.current) setLoaded(true);
    });
    return () => {
      disposedRef.current = true;
    };
  }, [refresh]);

  const selectCalendar = useCallback(async (calendarId: string | null): Promise<void> => {
    const state = await loadCalendarSyncState();
    await saveCalendarSyncState({ ...state, preferredCalendarId: calendarId });
    setPreferredCalendarId(calendarId);
  }, []);

  return {
    calendars,
    preferredCalendarId,
    permission,
    loaded,
    selectCalendar,
    refresh,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
