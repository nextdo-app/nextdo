/**
 * Issue #100: read-only system-calendar busy blocks for the Now screen.
 *
 * The OS calendar is the user's real schedule. When the import switch is on,
 * timed busy events become hard `CalendarBlock`s for the engine; the pure
 * filter (which events count, and how Nextdo's own mirrored events are
 * excluded) lives in `lib/calendar-sync/import.ts`.
 *
 * Refresh policy:
 *   - on mount and whenever the settings switch flips on;
 *   - every five minutes while the Now screen is mounted;
 *   - when the app returns to the foreground (the user may have just edited
 *     their calendar in another app).
 *
 * A failed read KEEPS the last successful snapshot and surfaces a Chinese
 * notice — silently dropping constraints would make the engine recommend an
 * action that conflicts with a real appointment. The snapshot is module-level
 * so a Now remount does not lose it; it is never written to disk (an import
 * is cheap, and a stale file after a reboot would be worse than no blocks).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { logger, type CalendarBlock } from '@nextdo/core';
import { listEventsForImport } from '@/lib/calendar-sync';
import {
  busyBlocksFromEvents,
  IMPORT_LOOKAHEAD_MS,
  IMPORT_LOOKBACK_MS,
} from '@/lib/calendar-sync/import';
import { loadCalendarSyncState } from '@/lib/calendar-sync/store';
import {
  loadNotificationSettings,
  subscribeToNotificationSettings,
} from '@/lib/notification-settings';

/** Five minutes: the Now screen cannot see a calendar edit sooner than this
 *  without a costly read on every clock tick. */
const REFRESH_INTERVAL_MS = 5 * 60_000;

/** User-facing copy shown on the Now screen; it must say what still works. */
export const CALENDAR_IMPORT_ERROR = '系统日历读取失败，暂未更新忙碌时间';

/** Last successful snapshot — survives a Now remount within this session. */
let cachedBlocks: CalendarBlock[] = [];

export interface ExternalCalendarBlocksResult {
  /** Hard blocks from the OS calendar; empty when the switch is off. */
  blocks: CalendarBlock[];
  /** Chinese notice when the last refresh failed; the blocks are the previous ones. */
  error: string | null;
  /** Manual refresh (the interval/foreground paths call the same function). */
  refresh: () => Promise<void>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Every event id Nextdo wrote (all three sync channels are excluded). */
async function nextdoEventIds(): Promise<Set<string>> {
  const state = await loadCalendarSyncState();
  const ids = new Set<string>();
  for (const bag of [state.mappings, state.reminderMappings, state.focusMappings]) {
    for (const mapping of Object.values(bag)) ids.add(mapping.eventId);
  }
  return ids;
}

export function useExternalCalendarBlocks(): ExternalCalendarBlocksResult {
  const [enabled, setEnabled] = useState(false);
  const [blocks, setBlocks] = useState<CalendarBlock[]>(cachedBlocks);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const runIdRef = useRef(0);
  /**
   * A settings event owns the switch after it arrives: the mount read may
   * resolve with the OLD stored blob after the user already toggled the
   * switch (the settings store updates its cache on write; an in-flight
   * read started before it does not). Applying the stale read would turn
   * the import back off under the user's finger.
   */
  const settingsChangedRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    const runId = ++runIdRef.current;
    if (!enabledRef.current) {
      setBlocks((previous) => (previous.length === 0 ? previous : []));
      setError(null);
      return;
    }
    try {
      const now = new Date();
      const events = await listEventsForImport(
        new Date(now.getTime() - IMPORT_LOOKBACK_MS),
        new Date(now.getTime() + IMPORT_LOOKAHEAD_MS),
      );
      if (runId !== runIdRef.current) return;
      // null = this host has no readable calendar. Keep the switch harmless
      // instead of reporting an error the user cannot act on.
      if (events === null || !enabledRef.current) return;
      const excludeEventIds = await nextdoEventIds();
      if (runId !== runIdRef.current || !enabledRef.current) return;
      const next = busyBlocksFromEvents(events, { excludeEventIds });
      cachedBlocks = next;
      setBlocks(next);
      setError(null);
    } catch (err: unknown) {
      if (runId !== runIdRef.current) return;
      logger.warn('system calendar import failed', toError(err));
      // Keep the previous blocks: a transient read failure must not remove a
      // very real appointment from the engine's constraints.
      setError(CALENDAR_IMPORT_ERROR);
    }
  }, []);

  // Follow the import switch. Reading the settings is async; until it
  // resolves the hook stays OFF, so no calendar module is touched.
  useEffect(() => {
    let disposed = false;
    const apply = (importEnabled: boolean): void => {
      if (importEnabled === enabledRef.current) return;
      enabledRef.current = importEnabled;
      setEnabled(importEnabled);
      if (importEnabled) {
        void refresh();
      } else {
        // Invalidate an import already in flight: its snapshot must not land
        // after the user turned the switch off.
        runIdRef.current += 1;
        setBlocks((previous) => (previous.length === 0 ? previous : []));
        setError(null);
      }
    };
    void loadNotificationSettings()
      .then((settings) => {
        if (disposed || settingsChangedRef.current) return;
        enabledRef.current = settings.calendarImportEnabled;
        setEnabled(settings.calendarImportEnabled);
        if (settings.calendarImportEnabled) {
          void refresh();
        } else {
          setBlocks((previous) => (previous.length === 0 ? previous : []));
        }
      })
      .catch((err: unknown) => {
        logger.warn('calendar import settings read failed', toError(err));
      });
    const unsubscribe = subscribeToNotificationSettings((settings) => {
      if (disposed) return;
      settingsChangedRef.current = true;
      apply(settings.calendarImportEnabled);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refresh]);

  // While enabled: refresh on an interval and when the app becomes active.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, refresh]);

  return { blocks, error, refresh };
}

/** Test seam — the module-level snapshot would otherwise leak between cases. */
export function __resetExternalCalendarBlocksForTests(): void {
  cachedBlocks = [];
}
