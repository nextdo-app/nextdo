/**
 * Native delivery adapter (iOS / Android — design §4.1):
 * expo-notifications, OS-persisted scheduling.
 *
 * - schedule  → `scheduleNotificationAsync` with the reminder ROW ID as the
 *   notification `identifier` (the reconcile join key, design §2.2);
 * - pending   → `getAllScheduledNotificationsAsync()` (the OS-persisted
 *   set — survives force-kill, so the reconcile stays correct after
 *   restart, AC2/AC7);
 * - intensity → iOS: per-notification sound (custom wav, declared in
 *   app.json) + `timeSensitive` for the alarm tier; Android: three
 *   channels with fixed importance (immutable after creation, OS rule)
 *   selected via `trigger.channelId` (design §2.3);
 * - click     → `addNotificationResponseReceivedListener` (hot start) +
 *   `getLastNotificationResponseAsync` (terminated cold start) → the
 *   callback routes to the Now tab (R4);
 * - Android 12+ exact alarm: granted via the `SCHEDULE_EXACT_ALARM` /
 *   `USE_EXACT_ALARM` manifest permissions (expo.android.permissions in
 *   app.json — without them the OS silently degrades to inexact alarms).
 *
 * No React imports — this is a plain module the hook binds to.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { logger } from '@nextdo/core';
import { resolvePermissionStatus } from '../permission-status';
import type { ReconcileItem, ReconcileOutput } from '../reminder-scheduler';
import type { DeliveryAdapter, ReminderPermissionState } from './types';
import { KIND_TITLES } from './types';

/**
 * The three Android channels (design §2.3). Importance is FIXED at first
 * creation (Android OS: only name/description are mutable afterwards), so
 * the parameters are settled once — the creation is idempotent
 * (`setNotificationChannelAsync` = "assigning the configuration to a
 * channel of a specified name (creating it if need be)").
 */
const CHANNEL_IDS = {
  normal: 'nextdo-normal',
  important: 'nextdo-important',
  alarm: 'nextdo-alarm',
} as const;

const INTENSITY_CHANNEL: Record<string, (typeof CHANNEL_IDS)[keyof typeof CHANNEL_IDS]> = {
  normal: CHANNEL_IDS.normal,
  important: CHANNEL_IDS.important,
  alarm: CHANNEL_IDS.alarm,
};

/**
 * Per-intensity custom sound (design §2.3): the BASE FILENAME is how both
 * platforms look it up (iOS: app.json plugin `sounds`; Android 8+: the
 * channel's `sound`). `normal` keeps the OS default.
 */
const INTENSITY_SOUND: Record<string, string | undefined> = {
  normal: undefined,
  important: 'important.wav',
  alarm: 'alarm.wav',
};

let channelsReady = false;
let responseListener: { remove(): void } | null = null;
let onOpened: (() => void) | null = null;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Create the three channels once (Android only; a no-op elsewhere). */
async function ensureChannels(): Promise<void> {
  if (channelsReady || Platform.OS !== 'android') return;
  const results = await Promise.allSettled([
    Notifications.setNotificationChannelAsync(CHANNEL_IDS.normal, {
      name: '提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_IDS.important, {
      name: '重要提醒',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'important.wav',
      enableVibrate: true,
      vibrationPattern: [0, 100],
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_IDS.alarm, {
      name: '闹钟提醒',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'alarm.wav',
      enableVibrate: true,
      vibrationPattern: [0, 200, 100, 200, 100, 500],
    }),
  ]);
  // A failed channel creation is not fatal (the fallback channel still
  // delivers) — but keep the channels retryable (channelsReady stays
  // false) and log for the field.
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    logger.warn(
      `notification channels: ${failures.length}/${results.length} failed`,
      toError(failures[0]?.reason),
    );
    return;
  }
  channelsReady = true;
}

async function scheduleOne(item: ReconcileItem): Promise<void> {
  const { row, title } = item;
  const sound = INTENSITY_SOUND[row.intensity];
  await Notifications.scheduleNotificationAsync({
    identifier: row.id,
    content: {
      title: KIND_TITLES[row.kind],
      body: title,
      // R4 payload (log + future deep-link; v1 routes to Now regardless):
      data: { reminderId: row.id, actionKind: row.kind, actionId: row.actionId },
      ...(sound !== undefined ? { sound } : {}),
      // alarm tier: break through Focus/Do-Not-Disturb (iOS, design §2.3).
      ...(row.intensity === 'alarm' ? { interruptionLevel: 'timeSensitive' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(row.firesAt),
      // Android 8+ picks the channel (and its sound/vibration) here.
      channelId: INTENSITY_CHANNEL[row.intensity] ?? CHANNEL_IDS.normal,
    },
  });
}

export function createNativeAdapter(): DeliveryAdapter {
  return {
    platform: 'native',

    async init(callback: () => void): Promise<void> {
      onOpened = callback;
      // Foreground presentation: the default banner + sound, badge off
      // (design §4.1 — without this handler, notifications that fire
      // while the app is in the foreground are NOT shown).
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      await ensureChannels();
      // Hot start: the tap arrives while JS is running.
      responseListener?.remove();
      responseListener = Notifications.addNotificationResponseReceivedListener(() => {
        onOpened?.();
      });
      // Cold start (terminated): the tap that LAUNCHED the app is still
      // retrievable exactly once — consume + clear it so a later hot
      // start never re-routes (the official expo-router pattern).
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last !== null) {
          onOpened?.();
          await Notifications.clearLastNotificationResponseAsync();
        }
      } catch (error) {
        logger.warn('last notification response read failed', toError(error));
      }
    },

    async listPendingIds(): Promise<Set<string>> {
      // Deliberately NO catch: a failed read must abort this reconcile
      // (retrying on the next trigger) — an empty set would make the
      // reconcile (re)schedule every already-armed row (duplicates).
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return new Set(requests.map((request) => request.identifier));
    },

    async apply(output: ReconcileOutput): Promise<void> {
      // The platform API cancels one identifier at a time (no batch
      // variant in expo-notifications 57).
      for (const id of output.toCancel) {
        await Notifications.cancelScheduledNotificationAsync(id);
      }
      for (const item of output.toSchedule) {
        await scheduleOne(item);
      }
      // toFireNow is tauri-only (the pure reconcile never produces it in
      // native mode — past rows fire naturally, R7).
    },

    async permission(): Promise<ReminderPermissionState> {
      try {
        const response = await Notifications.getPermissionsAsync();
        return {
          platform: 'native',
          status: resolvePermissionStatus(response.status, response.ios?.status),
          canAskAgain: response.canAskAgain,
        };
      } catch (error) {
        // Undetermined is the safe default: the contextual request (the
        // snooze path) will try again — never report a false "denied".
        logger.warn('notification permission read failed', toError(error));
        return { platform: 'native', status: 'undetermined', canAskAgain: true };
      }
    },

    async requestPermission(): Promise<ReminderPermissionState> {
      try {
        const response = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: false, allowSound: true },
        });
        return {
          platform: 'native',
          status: resolvePermissionStatus(response.status, response.ios?.status),
          canAskAgain: response.canAskAgain,
        };
      } catch (error) {
        logger.warn('notification permission request failed', toError(error));
        return this.permission();
      }
    },

    async openSystemSettings(): Promise<void> {
      if (Platform.OS === 'android') {
        // 直达本应用的通知设置页（Obtainium / Telegram 同款做法）。带 package:
        // data 的 ACTION_APP_NOTIFICATION_SETTINGS 在 API 26+ 被设置页接受；
        // 老 ROM 上用 extra 传包名，仍不认时改开应用详情页。
        const pkg = Constants.expoConfig?.android?.package;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const launcher = require('expo-intent-launcher') as {
            startActivityAsync(
              action: string,
              options?: Record<string, unknown>,
            ): Promise<unknown>;
          };
          const hasPkg = typeof pkg === 'string' && pkg !== '';
          await launcher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
            ...(hasPkg
              ? {
                  data: `package:${pkg}`,
                  extra: { 'android.provider.extra.APP_PACKAGE': pkg },
                }
              : {}),
          });
          return;
        } catch (error) {
          logger.warn('open android notification settings failed', toError(error));
        }
        try {
          await Linking.openSettings();
        } catch (error) {
          logger.warn('open system settings failed', toError(error));
        }
        return;
      }
      try {
        // expo-notifications 57 exposes no openSettings() — the
        // `app-settings:` URL scheme opens THIS app's page in the system
        // Settings (the standard iOS pattern).
        await Linking.openURL('app-settings:');
      } catch (error) {
        logger.warn('open system settings failed', toError(error));
      }
    },

    dispose(): void {
      responseListener?.remove();
      responseListener = null;
      onOpened = null;
    },
  };
}
