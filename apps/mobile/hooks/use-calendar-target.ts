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
import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarPermission,
  isCalendarSupported,
  listCalendars,
  type WritableCalendar,
} from '@/lib/calendar-sync';
import { loadCalendarSyncState, saveCalendarSyncState } from '@/lib/calendar-sync/store';
import { logger } from '@nextdo/core';

export interface UseCalendarTargetResult {
  /** Calendars the user can write into; read-only ones are filtered out. */
  calendars: WritableCalendar[];
  /** The picked calendar id, or null for "Nextdo default". */
  preferredCalendarId: string | null;
  /** True once the list has been read at least once. */
  loaded: boolean;
  /** Persist a choice; null restores the Nextdo default. */
  selectCalendar: (calendarId: string | null) => Promise<void>;
}

export function useCalendarTarget(): UseCalendarTargetResult {
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const [preferredCalendarId, setPreferredCalendarId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const state = await loadCalendarSyncState();
      if (!disposed) setPreferredCalendarId(state.preferredCalendarId);
      // Listing needs the permission: an unread list is a normal answer (the
      // user never granted it), not an error to surface.
      const supported = await isCalendarSupported();
      if (!supported) {
        if (!disposed) setLoaded(true);
        return;
      }
      const permission = await getCalendarPermission();
      if (permission !== 'granted') {
        if (!disposed) setLoaded(true);
        return;
      }
      const available = await listCalendars();
      if (disposed) return;
      setCalendars(available.filter((calendar) => calendar.allowsModifications));
      setLoaded(true);
    })().catch((error: unknown) => {
      logger.warn('reading the calendar list failed', toError(error));
      if (!disposed) setLoaded(true);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const selectCalendar = useCallback(async (calendarId: string | null): Promise<void> => {
    const state = await loadCalendarSyncState();
    await saveCalendarSyncState({ ...state, preferredCalendarId: calendarId });
    setPreferredCalendarId(calendarId);
  }, []);

  return { calendars, preferredCalendarId, loaded, selectCalendar };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
