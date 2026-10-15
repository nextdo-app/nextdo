/**
 * Habit check-in reminder preferences + sync (issue 32-A).
 *
 * Persisted using the same platform matrix as `engine-context.ts`:
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage`
 *   Node / fallback → in-memory
 *
 * Safe to import on Node/jest.
 */
import { isReactNativeRuntime } from '@nextdo/db';
import {
  DEFAULT_HABIT_REMINDER_OPTIONS,
  type HabitReminderOptions,
} from '@nextdo/db';

export const HABIT_REMINDER_SETTINGS_KEY = 'nextdo.settings.habit-reminders';

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
  removeItem(key: string): void;
}

function getWebLocalStorage(): WebStorageLike | null {
  const g = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return g.window?.localStorage ?? g.localStorage ?? null;
}

function isLocalStorageAvailable(): boolean {
  try {
    const storage = getWebLocalStorage();
    if (!storage) return false;
    const testKey = '__nextdo_probe__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function createLocalStorageStore(): KeyValue {
  return {
    async getItem(key) {
      try {
        const storage = getWebLocalStorage();
        if (storage) return storage.getItem(key);
      } catch {
        // Fall back gracefully
      }
      return null;
    },
    async setItem(key, value) {
      try {
        const storage = getWebLocalStorage();
        if (storage) {
          storage.setItem(key, value);
          return;
        }
      } catch {
        // Ignore quota
      }
    },
  };
}

function createSecureStoreStore(): KeyValue {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('expo-secure-store') as {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
  };
  return {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
  };
}

let backend: KeyValue | null = null;
let cachedSettings: HabitReminderOptions | null = null;
let pendingLoad: Promise<HabitReminderOptions> | null = null;

function getBackend(): KeyValue {
  if (backend === null) {
    if (isReactNativeRuntime()) {
      backend = createSecureStoreStore();
    } else if (isLocalStorageAvailable()) {
      backend = createLocalStorageStore();
    } else {
      backend = createMemoryStore();
    }
  }
  return backend;
}

export function parseHabitReminderOptions(raw: string | null): HabitReminderOptions {
  if (raw === null) return DEFAULT_HABIT_REMINDER_OPTIONS;
  try {
    const parsed = JSON.parse(raw) as Partial<HabitReminderOptions>;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_HABIT_REMINDER_OPTIONS;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_HABIT_REMINDER_OPTIONS.enabled,
      allDayReminderHhmm:
        typeof parsed.allDayReminderHhmm === 'string' && /^\d{1,2}:\d{2}$/.test(parsed.allDayReminderHhmm)
          ? parsed.allDayReminderHhmm
          : DEFAULT_HABIT_REMINDER_OPTIONS.allDayReminderHhmm,
    };
  } catch {
    return DEFAULT_HABIT_REMINDER_OPTIONS;
  }
}

export async function loadHabitReminderOptions(): Promise<HabitReminderOptions> {
  if (cachedSettings !== null) return cachedSettings;
  if (pendingLoad !== null) return pendingLoad;
  pendingLoad = getBackend()
    .getItem(HABIT_REMINDER_SETTINGS_KEY)
    .then((raw) => {
      const parsed = parseHabitReminderOptions(raw);
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

export async function saveHabitReminderOptions(options: HabitReminderOptions): Promise<void> {
  cachedSettings = options;
  await getBackend().setItem(HABIT_REMINDER_SETTINGS_KEY, JSON.stringify(options));
}

/** Test hook: point the module at a specific backend (null = reset). */
export function __setHabitReminderStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
}
