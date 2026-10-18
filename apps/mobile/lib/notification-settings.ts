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

export interface NotificationSettings {
  /**
   * The in-app master switch (R2). OFF suppresses delivery entirely —
   * `computeReconcile` withdraws every armed OS notification and schedules
   * nothing until it is back on. Defaults to ON: a device that never touched
   * the switch keeps the behavior it had before issue #24 shipped.
   */
  masterEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  masterEnabled: true,
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

/** Normalize a stored value; anything unreadable falls back to the defaults. */
export function parseNotificationSettings(raw: string | null): NotificationSettings {
  if (raw === null) return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTIFICATION_SETTINGS;
    return {
      masterEnabled:
        typeof parsed.masterEnabled === 'boolean'
          ? parsed.masterEnabled
          : DEFAULT_NOTIFICATION_SETTINGS.masterEnabled,
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
