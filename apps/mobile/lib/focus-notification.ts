/**
 * Issue #60 — OS-level notifications for the focus timer.
 *
 * The in-app tone (`lib/notification-sound.ts`) is the primary cue while the
 * app is foregrounded; these notifications are the fallback that still
 * reaches the user when the client is muted, backgrounded or closed:
 *
 * - 专注结束 → an immediate notification with the duration + action context;
 *   tapping it opens the focus screen for that action (native `data.route`;
 *   the web notification focuses the tab).
 * - 休息结束 → scheduled ahead when the break starts (native DATE trigger, so
 *   it survives force-kill); on web the focus screen's own timeout presents
 *   it (`notifyBreakComplete`) because a page timer cannot outlive the tab.
 *
 * Permission is the SAME OS grant the reminder engine uses, so it is read /
 * requested through the delivery adapter (`useReminderPermission`) — this
 * module only sends. A denied permission never blocks the timer: the focus
 * screen shows the guidance row and the OS simply drops the send.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logger } from '@nextdo/core';
import { loadNotificationSettings } from '@/lib/notification-settings';
import { NOTIFICATION_CHANNEL_IDS } from '@/lib/notification-channels';

/** The break-end notification's fixed identifier — rescheduling replaces the
 *  previous break instead of arming a second one. */
const BREAK_IDENTIFIER = 'nextdo-focus-break-end';

/** Android channel ids (shared with the reminder adapter — same OS state). */
const CHANNEL_SOUND = NOTIFICATION_CHANNEL_IDS.important;
const CHANNEL_SILENT = NOTIFICATION_CHANNEL_IDS.silent;

export interface FocusCompleteNotice {
  actionKind: string;
  actionId: string;
  actionTitle: string;
  minutes: number;
}

interface WebNotificationInstance {
  onclick: (() => void) | null;
}

interface WebNotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
}

interface WebNotificationCtor {
  new (title: string, options?: WebNotificationOptions): WebNotificationInstance;
  permission: 'default' | 'granted' | 'denied';
}

interface WebHostWindow {
  Notification?: WebNotificationCtor;
  focus?: () => void;
}

/** The app tsconfig has no DOM lib — reach the browser globals through a
 *  typed view (the web reminder adapter's pattern). */
function getWebWindow(): WebHostWindow | undefined {
  return typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { window?: WebHostWindow }).window
    : undefined;
}

/** The focus screen's route — the deep link a notification tap opens. */
function focusRoute(kind: string, id: string): string {
  return `/focus/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`;
}

async function focusSoundEnabled(): Promise<boolean> {
  try {
    const settings = await loadNotificationSettings();
    return settings.focusSoundEnabled;
  } catch {
    // A preference-read failure must never suppress the reminder itself.
    return true;
  }
}

function showWebNotification(
  title: string,
  body: string,
  tag: string,
  silent: boolean,
): void {
  const win = getWebWindow();
  const Ctor = win?.Notification;
  if (Ctor === undefined || Ctor.permission !== 'granted') return;
  try {
    const notification = new Ctor(title, {
      body,
      tag,
      silent,
      icon: '/icons/icon-192.png',
    });
    // The focus screen IS the current page — focusing the tab is all the
    // navigation a browser notification can do.
    notification.onclick = () => {
      win?.focus?.();
    };
  } catch (error) {
    logger.warn('focus web notification failed', error);
  }
}

/**
 * 专注结束 (time-up): an immediate OS notification. Foreground the OS banner
 * is silent — the in-app tone already plays — but the notification also
 * lands in the notification center when the app is backgrounded/closed.
 */
export async function notifyFocusComplete(notice: FocusCompleteNotice): Promise<void> {
  const sound = await focusSoundEnabled();
  const title = '专注结束';
  const body = `本次专注 ${notice.minutes} 分钟已记录 — ${notice.actionTitle}。该休息一下了。`;

  if (Platform.OS === 'web') {
    showWebNotification(title, body, 'nextdo-focus-complete', !sound);
    return;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          focusNotification: true,
          route: focusRoute(notice.actionKind, notice.actionId),
        },
        ...(sound ? {} : { sound: false }),
      },
      trigger:
        Platform.OS === 'android'
          ? { channelId: sound ? CHANNEL_SOUND : CHANNEL_SILENT }
          : null,
    });
  } catch (error) {
    logger.warn('focus completion notification failed', error);
  }
}

/**
 * Arms the 休息结束 notification (native only). The focus screen sets its own
 * timeout for the visible countdown; this is the copy that survives the app
 * being backgrounded or killed.
 */
export async function scheduleBreakEnd(endsAt: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  const sound = await focusSoundEnabled();
  try {
    await Notifications.cancelScheduledNotificationAsync(BREAK_IDENTIFIER);
  } catch {
    // Nothing armed yet — cancellation is best-effort.
  }
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: BREAK_IDENTIFIER,
      content: {
        title: '休息结束',
        body: '开始下一轮专注吧。',
        data: { focusNotification: true, route: '/(tabs)/now' },
        ...(sound ? {} : { sound: false }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: endsAt,
        ...(Platform.OS === 'android'
          ? { channelId: sound ? CHANNEL_SOUND : CHANNEL_SILENT }
          : {}),
      },
    });
  } catch (error) {
    logger.warn('break-end notification schedule failed', error);
  }
}

/** Ending the break early (or leaving the screen) must not leave the OS
 *  copy armed. Safe to call when nothing was scheduled. */
export async function cancelBreakEnd(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(BREAK_IDENTIFIER);
  } catch {
    // Idempotent by design — nothing armed is a no-op.
  }
}

/** 休息结束 while the app is open (web: the page timeout presents it; native
 *  already has the scheduled copy firing, so this is a no-op there). */
export function notifyBreakComplete(): void {
  if (Platform.OS !== 'web') return;
  void focusSoundEnabled().then((sound) => {
    showWebNotification('休息结束', '开始下一轮专注吧。', 'nextdo-break-complete', !sound);
  });
}
