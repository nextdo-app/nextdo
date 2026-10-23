/**
 * The reminder delivery hook (task 09-30 design §5) — mounted ONCE at the
 * root layout (inside the PowerSync provider, via the `<ReminderDelivery/>`
 * null component):
 *
 *   mount       → adapter.init (foreground handler + channels + click
 *                 listener) → first reconcile
 *   data change → powersync.onChange on the 5 reminder-relevant tables
 *                 (local writes AND sync inflow) → 1 s debounce →
 *                 reconcile
 *   foreground  → native AppState 'active' / webview 'focus' → reconcile
 *                 (AC2: after OS-persisted scheduling this is drift
 *                 protection, not the primary trigger)
 *   tauri tick  → 30 s setInterval (desktop in-session delivery, design
 *                 §4.2 — ±35 s accuracy, PRD R3)
 *
 * The reconcile itself is PURE (`lib/reminders/reminder-scheduler.ts`,
 * unit-tested); this hook is only the wiring.
 *
 * Concurrency: every trigger enqueues onto ONE promise chain (the queue
 * ref) — at most one reconcile runs at a time, and the operations are
 * idempotent (list pending → schedule the missing, AC7), so
 * start / foreground churn never duplicates a schedule.
 *
 * Clock: the reconcile reads a FRESH Date at run time — the delivery
 * engine's own clock. This is the sanctioned exception to
 * hook-guidelines Rule 4 (which governs UI derivations from watch data):
 * the 30 s desktop tick needs sub-minute accuracy that the minute-granular
 * app clock cannot provide, and a snooze written 59 s after the last
 * minute tick must still schedule. The engine still receives `now` as a
 * parameter (the rule's real requirement).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { usePowerSync } from '@powersync/react';
import { listScheduledReminders, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { getDeliveryAdapter, type ReminderPermissionState } from '@/lib/reminders/adapters';
import { postDebugLog } from '@/lib/reminders/debug-log';
import { getCalendarPermission } from '@/lib/calendar-sync';
import { calendarOwnsReminderDelivery } from '@/lib/calendar-sync/reminder-plan';
import { computeReconcile } from '@/lib/reminders/reminder-scheduler';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  subscribeToNotificationSettings,
} from '@/lib/notification-settings';

/** The tables whose rows feed `listScheduledReminders` or its title joins
 *  (design §5.2 — the onChange watchlist). */
const WATCHED_TABLES = ['reminders', 'next_actions', 'calendar_actions', 'habit_days', 'habits'];

/** Design §3: coalesce dense onChange bursts (a sync inflow touches every
 *  table at once). */
const ON_CHANGE_DEBOUNCE_MS = 1000;

/** Design §4.2: the desktop tick (accuracy ±35 s, PRD R3). */
const TAURI_TICK_MS = 30_000;

/** R4: a notification tap lands on the Now tab. */
const NOW_TAB_ROUTE = '/(tabs)/now';

export interface UseReminderDeliveryResult {
  /** The current OS permission state (null until the first read resolves)
   *  — exported for completeness; the Settings screen uses
   *  `useReminderPermission` (its own fresh read) instead. */
  permission: ReminderPermissionState | null;
}

export function useReminderDelivery(): UseReminderDeliveryResult {
  const powersync = usePowerSync();
  const router = useRouter();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const adapter = getDeliveryAdapter();
  const [permission, setPermission] = useState<ReminderPermissionState | null>(null);

  // The router identity is not stable across renders — the init callback
  // must not depend on it (the effect would re-run needlessly).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // The reconcile queue: one promise chain, at most one reconcile in
  // flight (design §3 — "reconcile 走单条 promise 链").
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // The in-app master switch (issue #24 R2). Held in a ref so a reconcile
  // queued by a poke reads the value AT RUN TIME, not the render-time closure.
  const masterEnabledRef = useRef(DEFAULT_NOTIFICATION_SETTINGS.masterEnabled);
  // Issue #63: `calendar` means the system calendar is the notifier — the
  // app must then hold NO pending notification, or the user is told twice.
  const reminderChannelRef = useRef(DEFAULT_NOTIFICATION_SETTINGS.reminderChannel);

  const runReconcile = useCallback((): Promise<unknown> => {
    const mode = adapter.platform === 'web' ? null : adapter.platform;
    if (mode === null) return Promise.resolve();
    queueRef.current = queueRef.current
      .then(async () => {
        const rows = await listScheduledReminders(db);
        const pendingIds = await adapter.listPendingIds();
        const tauriContext = adapter.tauriContext?.();
        // The calendar channel only exists on iOS/Android (`useCalendarSync`
        // is mounted there alone), so on any other platform the app keeps
        // delivering even with `reminderChannel: 'calendar'`. A denied or
        // unasked-for calendar permission also keeps the app in charge —
        // otherwise picking the calendar channel with no access would silence
        // reminders entirely.
        const calendarOwnsDelivery = calendarOwnsReminderDelivery({
          platform: adapter.platform,
          channel: reminderChannelRef.current,
          permission: await getCalendarPermission(),
        });
        const output = computeReconcile({
          mode,
          enabled: masterEnabledRef.current && !calendarOwnsDelivery,
          // A FRESH clock per reconcile (see the module doc — the
          // sanctioned exception to Rule 4).
          now: new Date(),
          rows,
          pendingIds,
          ...(tauriContext !== undefined
            ? { firedIds: tauriContext.firedIds, sessionStart: tauriContext.sessionStart }
            : {}),
        });
        // Field diagnostics for the desktop delivery path (no-op outside
        // the release loopback origin — see lib/reminders/debug-log).
        postDebugLog({
          kind: 'reconcile',
          platform: adapter.platform,
          now: new Date().toISOString(),
          rows: rows.length,
          toSchedule: output.toSchedule.length,
          toCancel: output.toCancel.length,
          toFireNow: output.toFireNow.map((item) => item.row.id),
        });
        if (output.toSchedule.length > 0 || output.toCancel.length > 0 || output.toFireNow.length > 0) {
          await adapter.apply(output);
        }
      })
      .catch((error: unknown) => {
        // A failed reconcile is retried by the NEXT trigger (onChange /
        // foreground / tick) — the adapter operations are individually
        // idempotent, so nothing is left half-applied in a harmful way.
        logger.warn(
          'reminder reconcile failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return queueRef.current;
  }, [db, adapter]);

  // Mount: init the adapter (handler + channels + listeners), run the
  // first reconcile, read the permission.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        await adapter.init((route) => {
          // Issue #60: a focus notification carries its own deep link; a
          // reminder has none and lands on the Now tab (R4).
          routerRef.current.replace((route ?? NOW_TAB_ROUTE) as Href);
        });
      } catch (error) {
        // init failure (e.g. a channel error on a weird ROM) must not
        // brick the app — delivery degrades, the rest of the app runs.
        logger.warn(
          'reminder delivery init failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      if (disposed) return;
      // Load the in-app master switch BEFORE the first reconcile: with the
      // switch off, scheduling and immediately withdrawing would leave the OS
      // briefly holding a notification the user has switched off (R2).
      try {
        const settings = await loadNotificationSettings();
        if (disposed) return;
        masterEnabledRef.current = settings.masterEnabled;
        reminderChannelRef.current = settings.reminderChannel;
        // Issue #54: the adapter needs the sound preferences before it arms
        // anything (the silent channel / `sound: false` live there).
        await adapter.setSoundPreferences?.({
          enabled: settings.reminderSoundEnabled,
          tone: settings.soundTone,
        });
      } catch (error) {
        // Keep the default (ON) — a preference-read failure must never stop
        // delivery.
        logger.warn(
          'notification settings read failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      void runReconcile();
      void adapter
        .permission()
        .then((state) => {
          if (!disposed) setPermission(state);
        })
        .catch(() => undefined);
    })();
    return () => {
      disposed = true;
      adapter.dispose();
    };
  }, [adapter, runReconcile]);

  // Data changes (local writes + sync inflow) — debounced (design §5.2).
  // Skipped on plain web: the noop adapter has nothing to reconcile.
  useEffect(() => {
    if (adapter.platform === 'web') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dispose = powersync.onChange(
      {
        onChange: () => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            void runReconcile();
          }, ON_CHANGE_DEBOUNCE_MS);
        },
      },
      { tables: WATCHED_TABLES },
    );
    return () => {
      if (timer !== null) clearTimeout(timer);
      dispose();
    };
  }, [powersync, runReconcile, adapter]);

  // Foreground return (AC2 drift protection): native AppState 'active' /
  // tauri webview 'focus'.
  useEffect(() => {
    if (adapter.platform === 'web') return;
    if (Platform.OS === 'web') {
      const host = globalThis as {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      const onFocus = (): void => {
        void runReconcile();
      };
      host.addEventListener?.('focus', onFocus);
      return () => {
        host.removeEventListener?.('focus', onFocus);
      };
    }
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void runReconcile();
    });
    return () => {
      subscription.remove();
    };
  }, [adapter, runReconcile]);

  // The in-app master switch (issue #24 R2) and the sound preferences
  // (issue #54): follow the stored preference and re-reconcile on every
  // change — that pass is what withdraws an armed OS schedule the moment the
  // switch goes off, and re-arms on the right channel after a sound change.
  useEffect(() => {
    return subscribeToNotificationSettings((settings) => {
      masterEnabledRef.current = settings.masterEnabled;
      reminderChannelRef.current = settings.reminderChannel;
      void Promise.resolve(
        adapter.setSoundPreferences?.({
          enabled: settings.reminderSoundEnabled,
          tone: settings.soundTone,
        }),
      ).then(() => runReconcile());
    });
  }, [adapter, runReconcile]);

  // The desktop tick (tauri only — in-session delivery, design §4.2).
  useEffect(() => {
    if (adapter.platform !== 'tauri') return;
    const intervalId = setInterval(() => {
      // R2: with the switch off there is nothing to deliver, and tauri holds
      // no OS-side schedule to withdraw — skip the DB read entirely.
      if (!masterEnabledRef.current) return;
      void runReconcile();
    }, TAURI_TICK_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [adapter, runReconcile]);

  return { permission };
}
