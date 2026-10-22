/**
 * Calendar sync engine (issue #54, extended by issue #63) — mounted ONCE at
 * the root layout (inside the PowerSync provider, via the `<CalendarSync/>`
 * null component).
 *
 * Mirrors the reminder delivery engine's shape: one promise chain (at most
 * one reconcile in flight), a debounced watch, and a reconcile on every
 * settings change that flips a switch.
 *
 * TWO independent sources share one OS calendar:
 *   1. `calendar_actions` (issue #54) — the action's own time block, gated by
 *      the `calendarEnabled` switch;
 *   2. `reminders` (issue #63) — the reminder delivered as a calendar event
 *      with an alarm, gated by `reminderChannel !== 'app'`. This is the
 *      channel that survives the app being force-killed.
 * Their mappings are stored separately (`mappings` / `reminderMappings`) so
 * turning one off never withdraws the other's events.
 *
 * Three gates, in order:
 *   1. the in-app switches above (Settings),
 *   2. the OS calendar permission (never prompted from here — the Settings
 *      screen owns the request so the user sees the intent),
 *   3. a resolved target calendar (Nextdo's own, else a writable one).
 *
 * Turning a switch off deletes every event that channel created; a revoked
 * permission simply leaves the mapping in place so a later grant can clean up.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { usePowerSync } from '@powersync/react';
import { listCalendarActions, listScheduledReminders, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import type { ExpoCalendar } from 'expo-calendar';
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
  type CalendarSyncPlan,
} from '@/lib/calendar-sync/reconcile';
import { buildReminderCalendarPlan } from '@/lib/calendar-sync/reminder-plan';
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

/**
 * Apply one channel's plan, mutating `nextMappings` in place. Failures are
 * logged inside the device layer; a mapping that could not be written is
 * dropped so the next pass retries from scratch rather than forever.
 */
async function applyPlan(
  calendar: ExpoCalendar,
  plan: CalendarSyncPlan,
  nextMappings: CalendarSyncMappings,
): Promise<void> {
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
    // The event disappeared from the system calendar app — re-create it.
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
}

export function useCalendarSync(): void {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const switchesRef = useRef<{ actions: boolean; reminders: boolean } | null>(null);

  const runSync = useCallback((): void => {
    queueRef.current = queueRef.current
      .then(async () => {
        const settings = await loadNotificationSettings();
        const actionsEnabled = settings.calendarEnabled;
        // Issue #63: a reminder is delivered through the system calendar
        // unless the user explicitly kept the app's own notification only.
        const remindersEnabled = settings.reminderChannel !== 'app';
        switchesRef.current = { actions: actionsEnabled, reminders: remindersEnabled };
        const state = await loadCalendarSyncState();

        const nothingLeft =
          Object.keys(state.mappings).length === 0 &&
          Object.keys(state.reminderMappings).length === 0;
        if (!actionsEnabled && !remindersEnabled && nothingLeft) {
          if (state.calendarId !== null) await clearCalendarSyncState();
          return;
        }

        const permission = await getCalendarPermission();
        if (permission !== 'granted') return;

        const calendar = await ensureCalendar();
        if (calendar === null) return;

        const nextMappings: CalendarSyncMappings = {};
        const nextReminderMappings: CalendarSyncMappings = {};

        if (actionsEnabled) {
          const actions = await listCalendarActions(db);
          const plan = buildCalendarSyncPlan({
            enabled: true,
            actions,
            mappings: state.mappings,
            // The engine's own fresh clock — the same sanctioned exception
            // the reminder delivery hook documents for its reconcile.
            now: new Date(),
          });
          Object.assign(nextMappings, plan.retained);
          await applyPlan(calendar, plan, nextMappings);
        } else {
          // Switch off (or never on): withdraw whatever this channel owns.
          for (const mapping of Object.values(state.mappings)) {
            await deleteCalendarEvent(mapping.eventId);
          }
        }

        if (remindersEnabled) {
          const rows = await listScheduledReminders(db);
          const plan = buildReminderCalendarPlan({
            enabled: true,
            rows,
            mappings: state.reminderMappings,
            now: new Date(),
          });
          Object.assign(nextReminderMappings, plan.retained);
          await applyPlan(calendar, plan, nextReminderMappings);
        } else {
          for (const mapping of Object.values(state.reminderMappings)) {
            await deleteCalendarEvent(mapping.eventId);
          }
        }

        const keepCalendar =
          Object.keys(nextMappings).length > 0 || Object.keys(nextReminderMappings).length > 0;
        if (!keepCalendar && state.calendarId === null) return;
        await saveCalendarSyncState({
          calendarId: keepCalendar ? calendar.id : null,
          mappings: nextMappings,
          reminderMappings: nextReminderMappings,
        });
      })
      .catch((error: unknown) => {
        // The next trigger retries; every step is idempotent.
        logger.warn('calendar sync failed', toError(error));
      });
  }, [db]);

  // Mount: prime the switches, run once, then follow changes + data edits.
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    let disposed = false;
    void loadNotificationSettings()
      .then((settings) => {
        switchesRef.current = {
          actions: settings.calendarEnabled,
          reminders: settings.reminderChannel !== 'app',
        };
        if (!disposed) runSync();
      })
      .catch((error: unknown) => {
        logger.warn('calendar sync settings read failed', toError(error));
      });
    const unsubscribe = subscribeToNotificationSettings((settings) => {
      const previous = switchesRef.current;
      const next = {
        actions: settings.calendarEnabled,
        reminders: settings.reminderChannel !== 'app',
      };
      switchesRef.current = next;
      if (
        previous === null ||
        previous.actions !== next.actions ||
        previous.reminders !== next.reminders
      ) {
        runSync();
      }
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
      // `reminders` drives the reminder channel; the action tables carry the
      // title / note / time a reminder event displays.
      { tables: ['calendar_actions', 'next_actions', 'reminders'] },
    );
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      dispose();
    };
  }, [powersync, runSync]);
}
