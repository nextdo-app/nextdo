/**
 * Calendar sync engine (issue #54) — mounted ONCE at the root layout
 * (inside the PowerSync provider, via the `<CalendarSync/>` null component).
 *
 * Mirrors the reminder delivery engine's shape: one promise chain (at most
 * one reconcile in flight), a debounced `calendar_actions` watch, and a
 * reconcile on every settings change that flips the switch.
 *
 * Three gates, in order:
 *   1. the in-app `calendarEnabled` preference (Settings toggle),
 *   2. the OS calendar permission (never prompted from here — the Settings
 *      screen owns the request so the user sees the intent),
 *   3. a resolved target calendar (Nextdo's own, else a writable one).
 *
 * Turning the switch off deletes every event we created and clears the
 * device-local mapping; a revoked permission simply leaves the mapping in
 * place so a later grant can clean up.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { usePowerSync } from '@powersync/react';
import { listCalendarActions, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  ensureCalendar,
  getCalendarPermission,
  updateCalendarEvent,
} from '@/lib/calendar-sync/device';
import {
  buildCalendarSyncPlan,
  type CalendarSyncMappings,
} from '@/lib/calendar-sync/reconcile';
import {
  clearCalendarSyncState,
  loadCalendarSyncState,
  saveCalendarSyncState,
} from '@/lib/calendar-sync/store';
import { loadNotificationSettings, subscribeToNotificationSettings } from '@/lib/notification-settings';

/** Coalesce dense onChange bursts (a sync inflow touches many rows at once). */
const ON_CHANGE_DEBOUNCE_MS = 1000;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useCalendarSync(): void {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enabledRef = useRef<boolean | null>(null);

  const runSync = useCallback((): void => {
    queueRef.current = queueRef.current
      .then(async () => {
        const settings = await loadNotificationSettings();
        enabledRef.current = settings.calendarEnabled;
        const state = await loadCalendarSyncState();

        if (!settings.calendarEnabled) {
          if (Object.keys(state.mappings).length === 0) {
            if (state.calendarId !== null) await clearCalendarSyncState();
            return;
          }
          // Remove what we created. Failures are logged inside the device
          // layer and the mapping is dropped regardless — keeping a dead
          // mapping would retry forever.
          for (const mapping of Object.values(state.mappings)) {
            await deleteCalendarEvent(mapping.eventId);
          }
          await clearCalendarSyncState();
          return;
        }

        const permission = await getCalendarPermission();
        if (permission !== 'granted') return;

        const calendar = await ensureCalendar();
        if (calendar === null) return;

        const actions = await listCalendarActions(db);
        const plan = buildCalendarSyncPlan({
          enabled: true,
          actions,
          mappings: state.mappings,
          // The engine's own fresh clock — the same sanctioned exception the
          // reminder delivery hook documents for its reconcile.
          now: new Date(),
        });

        const nextMappings: CalendarSyncMappings = { ...plan.retained };

        for (const item of plan.toDelete) {
          await deleteCalendarEvent(item.eventId);
          delete nextMappings[item.actionId];
        }

        for (const item of plan.toUpdate) {
          const updated = await updateCalendarEvent(item);
          if (updated !== null) {
            nextMappings[item.actionId] = updated;
            continue;
          }
          // The event disappeared from the system calendar app — re-create.
          const created = await createCalendarEvent(calendar, item);
          if (created !== null) {
            nextMappings[item.actionId] = created;
          } else {
            delete nextMappings[item.actionId];
          }
        }

        for (const spec of plan.toCreate) {
          const created = await createCalendarEvent(calendar, spec);
          if (created !== null) nextMappings[spec.actionId] = created;
        }

        await saveCalendarSyncState({ calendarId: calendar.id, mappings: nextMappings });
      })
      .catch((error: unknown) => {
        // The next trigger retries; every step is idempotent.
        logger.warn('calendar sync failed', toError(error));
      });
  }, [db]);

  // Mount: prime the switch, run once, then follow changes + data edits.
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    let disposed = false;
    void loadNotificationSettings()
      .then((settings) => {
        enabledRef.current = settings.calendarEnabled;
        if (!disposed) runSync();
      })
      .catch((error: unknown) => {
        logger.warn('calendar sync settings read failed', toError(error));
      });
    const unsubscribe = subscribeToNotificationSettings((settings) => {
      const changed = enabledRef.current !== settings.calendarEnabled;
      enabledRef.current = settings.calendarEnabled;
      if (changed) runSync();
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dispose = powersync.onChange(
      {
        onChange: () => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            runSync();
          }, ON_CHANGE_DEBOUNCE_MS);
        },
      },
      { tables: ['calendar_actions'] },
    );
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      dispose();
    };
  }, [powersync, runSync]);
}
