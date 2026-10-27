/**
 * App-level notification preferences (issue #24, simplified by issue #45) —
 * the in-app master switch only.
 *
 * The first-run opt-in dialog and its `optInPromptSeen` flag are GONE (#45):
 * the app asks the OS at the moment it actually needs a notification
 * (`lib/reminders/permission.ts`, called from snooze / calendar submit /
 * habit reminders), never on launch. A stored blob that still carries the
 * old key is read fine — unknown fields are ignored, no migration needed.
 *
 * TWO independent layers gate a reminder notification, and this module owns
 * only one of them:
 *   - the OS permission — a platform fact, read/requested through
 *     `lib/reminders/adapters` (`useReminderPermission` on the Settings tab);
 *   - this in-app switch — a user preference the OS knows nothing about.
 * Both must allow delivery. Conflating them is how a screen ends up claiming
 * 「已开启」 while nothing can actually be delivered.
 *
 * Persisted with the platform matrix the app already uses for device-local
 * preferences (`lib/theme.ts`, `lib/habit-reminders.ts`, `lib/app-update.ts`):
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage`
 *   Node / fallback     → in-memory
 *
 * Safe to import on Node/jest (no platform module is touched until a read).
 */
import { isReactNativeRuntime } from '@nextdo/db';

export const NOTIFICATION_SETTINGS_KEY = 'nextdo.settings.notifications';

/** The in-app reminder tones (issue #54) — the asset basenames live in
 *  `lib/notification-sound.ts`; the stored value is just the choice. */
export type NotificationSoundTone = 'gentle' | 'important' | 'alarm';

export const NOTIFICATION_SOUND_TONES: readonly NotificationSoundTone[] = [
  'gentle',
  'important',
  'alarm',
];

export interface NotificationSettings {
  /**
   * The in-app master switch (R2). OFF suppresses delivery entirely —
   * `computeReconcile` withdraws every armed OS notification and schedules
   * nothing until it is back on. Defaults to ON: a device that never touched
   * the switch keeps the behavior it had before issue #24 shipped.
   */
  masterEnabled: boolean;
  /**
   * Issue #54: the focus-timer completion chime (independent of the reminder
   * switch — a user may want a quiet focus session without losing reminders).
   * Defaults to ON: reaching zero is the moment the user must look at the
   * screen. Plays in-app on every platform.
   */
  focusSoundEnabled: boolean;
  /**
   * Issue #54: the reminder sound switch. Native: whether the OS-delivered
   * notification plays a sound (silent channel / `sound: false`); Tauri:
   * whether the in-app tone plays with the desktop notification. Defaults ON.
   */
  reminderSoundEnabled: boolean;
  /** Issue #54: the in-app tone (focus completion + desktop reminder). Played
   *  at unity gain — the device volume is the only level control. */
  soundTone: NotificationSoundTone;
  /**
   * Issue #54: sync scheduled reminders with explicit time windows into the
   * system calendar (with a calendar alarm at the event start). Defaults OFF
   * — it needs a calendar permission prompt, so it is opt-in.
   */
  calendarEnabled: boolean;
  /**
   * Which channel delivers a reminder notification — EXACTLY one:
   *   `app`      — the app's own OS notification (default);
   *   `calendar` — a system calendar event with an alarm, so the OS calendar
   *                app notifies even when Nextdo is force-killed.
   *
   * There is deliberately no "both": two channels meant two notifications for
   * the same reminder. When the calendar channel is selected but the OS denied
   * permission, `calendarOwnsReminderDelivery` keeps the app delivering, so
   * nothing is ever lost by choosing one.
   */
  reminderChannel: ReminderDeliveryChannel;
}

/** Issue #63: how a reminder reaches the user. */
export type ReminderDeliveryChannel = 'app' | 'calendar';

export const REMINDER_DELIVERY_CHANNELS: readonly ReminderDeliveryChannel[] = [
  'app',
  'calendar',
];

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  masterEnabled: true,
  focusSoundEnabled: true,
  reminderSoundEnabled: true,
  soundTone: 'gentle',
  calendarEnabled: false,
  reminderChannel: 'app',
};

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function createMemoryStore(): KeyValue {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getWebLocalStorage(): WebStorageLike | null {
  const g = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return g.window?.localStorage ?? g.localStorage ?? null;
}

function createWebStore(): KeyValue {
  return {
    async getItem(key) {
      try {
        return getWebLocalStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        getWebLocalStorage()?.setItem(key, value);
      } catch {
        // A quota / private-mode refusal must not break the switch — the
        // in-memory cache keeps this session consistent either way.
      }
    },
  };
}

/** null when the module cannot be loaded (a bare Node/jest fallback path
 *  then takes over instead of the whole read throwing). */
function createSecureStoreStore(): KeyValue | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('expo-secure-store') as {
      getItemAsync(key: string): Promise<string | null>;
      setItemAsync(key: string, value: string): Promise<void>;
    };
    return {
      getItem: (key) => store.getItemAsync(key),
      setItem: (key, value) => store.setItemAsync(key, value),
    };
  } catch {
    return null;
  }
}

let backend: KeyValue | null = null;
let cachedSettings: NotificationSettings | null = null;
let pendingLoad: Promise<NotificationSettings> | null = null;

function getBackend(): KeyValue {
  if (backend === null) {
    const secure = isReactNativeRuntime() ? createSecureStoreStore() : null;
    backend =
      secure ?? (getWebLocalStorage() !== null ? createWebStore() : createMemoryStore());
  }
  return backend;
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Legacy `'both'` meant "calendar + app". With a single channel the calendar
 * wins: it is the delivery that survives the app being force-killed, and the
 * app already falls back to its own notification when the OS denied access
 * (`calendarOwnsReminderDelivery`). Anything unrecognized keeps the default.
 */
function normalizeReminderChannel(
  value: unknown,
  fallback: ReminderDeliveryChannel,
): ReminderDeliveryChannel {
  if (value === 'calendar' || value === 'both') return 'calendar';
  if (value === 'app') return 'app';
  return fallback;
}

/** Normalize a stored value; anything unreadable falls back to the defaults. */
export function parseNotificationSettings(raw: string | null): NotificationSettings {
  if (raw === null) return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTIFICATION_SETTINGS;
    const defaults = DEFAULT_NOTIFICATION_SETTINGS;
    return {
      masterEnabled: pickBoolean(parsed.masterEnabled, defaults.masterEnabled),
      focusSoundEnabled: pickBoolean(parsed.focusSoundEnabled, defaults.focusSoundEnabled),
      reminderSoundEnabled: pickBoolean(parsed.reminderSoundEnabled, defaults.reminderSoundEnabled),
      soundTone: pickEnum(parsed.soundTone, NOTIFICATION_SOUND_TONES, defaults.soundTone),
      calendarEnabled: pickBoolean(parsed.calendarEnabled, defaults.calendarEnabled),
      reminderChannel: normalizeReminderChannel(parsed.reminderChannel, defaults.reminderChannel),
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

type Listener = (settings: NotificationSettings) => void;

/** Live subscribers (the delivery engine's master switch). */
const listeners = new Set<Listener>();

/**
 * Follow preference changes. The delivery hook re-runs its reconcile on every
 * poke, and that pass is what withdraws an armed OS schedule the moment the
 * switch goes off. Returns the unsubscribe function.
 */
export function subscribeToNotificationSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  if (cachedSettings !== null) return cachedSettings;
  if (pendingLoad !== null) return pendingLoad;
  pendingLoad = getBackend()
    .getItem(NOTIFICATION_SETTINGS_KEY)
    .then((raw) => {
      const parsed = parseNotificationSettings(raw);
      cachedSettings = parsed;
      pendingLoad = null;
      return parsed;
    })
    .catch((err: unknown) => {
      pendingLoad = null;
      throw err;
    });
  return pendingLoad;
}

export async function saveNotificationSettings(
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const current = cachedSettings ?? (await loadNotificationSettings());
  const next: NotificationSettings = {
    masterEnabled: patch.masterEnabled ?? current.masterEnabled,
    focusSoundEnabled: patch.focusSoundEnabled ?? current.focusSoundEnabled,
    reminderSoundEnabled: patch.reminderSoundEnabled ?? current.reminderSoundEnabled,
    soundTone: patch.soundTone ?? current.soundTone,
    calendarEnabled: patch.calendarEnabled ?? current.calendarEnabled,
    reminderChannel: patch.reminderChannel ?? current.reminderChannel,
  };
  // Write FIRST, then adopt: a failed write must not leave the cache claiming
  // a preference the device never stored — the switch would read OFF while
  // delivery kept running.
  await getBackend().setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(next));
  cachedSettings = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A misbehaving subscriber must not break the write path.
    }
  }
  return next;
}

/** Test hook: point the module at a specific backend (null = reset). */
export function __setNotificationSettingsStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
  listeners.clear();
}
