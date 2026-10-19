/**
 * Focus-duration preference (issue #59): the last duration the user actually
 * chose before starting a session.
 *
 * The schema has NO settings table — adding one would touch the sync surface —
 * so this stays device-local, using the same platform matrix as `lib/theme.ts`,
 * `lib/notification-settings.ts` and `lib/habit-reminders.ts`:
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage`
 *   Node / fallback     → in-memory
 *
 * A missing / corrupt / out-of-range value means "no preference yet", which
 * keeps the pick step's default chip order intact.
 */
import { isReactNativeRuntime } from '@nextdo/db';
import { MAX_FOCUS_MINUTES, MIN_FOCUS_MINUTES } from '@nextdo/core';

export const FOCUS_SETTINGS_KEY = 'nextdo.settings.focus';

export { MAX_FOCUS_MINUTES, MIN_FOCUS_MINUTES };

export interface FocusSettings {
  /** The last duration the user picked, or null = never picked. */
  lastMinutes: number | null;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = { lastMinutes: null };

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
        // A quota / private-mode refusal must not break focus starts — the
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
let cachedSettings: FocusSettings | null = null;
let pendingLoad: Promise<FocusSettings> | null = null;

function getBackend(): KeyValue {
  if (backend === null) {
    const secure = isReactNativeRuntime() ? createSecureStoreStore() : null;
    backend = secure ?? (getWebLocalStorage() !== null ? createWebStore() : createMemoryStore());
  }
  return backend;
}

/** A duration is usable only as a whole minute inside the supported range. */
export function normalizeFocusMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minutes = Math.trunc(value);
  if (minutes !== value) return null;
  return minutes >= MIN_FOCUS_MINUTES && minutes <= MAX_FOCUS_MINUTES ? minutes : null;
}

/** Normalize a stored value; anything unreadable falls back to no preference. */
export function parseFocusSettings(raw: string | null): FocusSettings {
  if (raw === null) return DEFAULT_FOCUS_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<FocusSettings>;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FOCUS_SETTINGS;
    return { lastMinutes: normalizeFocusMinutes(parsed.lastMinutes) };
  } catch {
    return DEFAULT_FOCUS_SETTINGS;
  }
}

type Listener = (settings: FocusSettings) => void;

const listeners = new Set<Listener>();

/** Follow preference changes (the focus screen keeps its default in sync). */
export function subscribeToFocusSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadFocusSettings(): Promise<FocusSettings> {
  if (cachedSettings !== null) return cachedSettings;
  if (pendingLoad !== null) return pendingLoad;
  pendingLoad = getBackend()
    .getItem(FOCUS_SETTINGS_KEY)
    .then((raw) => {
      const parsed = parseFocusSettings(raw);
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

export async function saveFocusSettings(patch: Partial<FocusSettings>): Promise<FocusSettings> {
  const current = cachedSettings ?? (await loadFocusSettings());
  const next: FocusSettings = {
    lastMinutes:
      patch.lastMinutes === undefined ? current.lastMinutes : normalizeFocusMinutes(patch.lastMinutes),
  };
  // Write FIRST, then adopt: a failed write must not leave the cache claiming
  // a default the device never stored.
  await getBackend().setItem(FOCUS_SETTINGS_KEY, JSON.stringify(next));
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
export function __setFocusSettingsStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
  listeners.clear();
}
