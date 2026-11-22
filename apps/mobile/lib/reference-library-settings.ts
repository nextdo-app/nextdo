/**
 * Reference-library preference (issue #90) — the optional library switch.
 *
 * The library is ON by default: Clarify already writes ReferenceItems, and
 * hiding the only way to find them by default would strand existing data.
 * Turning it OFF hides the Now entry and the Clarify 「资料」 choice; it does
 * NOT delete, trash, or hide existing ReferenceItems from the database — the
 * user can turn the library back on and see them again.
 *
 * Persisted with the platform matrix the app already uses for device-local
 * preferences (`lib/theme.ts`, `lib/notification-settings.ts`,
 * `lib/app-update.ts`):
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage`
 *   Node / jest         → in-memory
 *
 * Safe to import on Node/jest (no platform module is touched until a read).
 */
import { isReactNativeRuntime } from '@nextdo/db';

export const REFERENCE_LIBRARY_SETTINGS_KEY = 'nextdo.settings.reference-library';

export interface ReferenceLibrarySettings {
  /** Show the Now entry and the Clarify 「资料」 choice. Defaults to ON. */
  enabled: boolean;
}

export const DEFAULT_REFERENCE_LIBRARY_SETTINGS: ReferenceLibrarySettings = {
  enabled: true,
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
        // A read failure is recoverable: the caller falls back to the default.
        return null;
      }
    },
    async setItem(key, value) {
      const store = getWebLocalStorage();
      if (store === null) {
        // The backend was selected while storage existed; it disappeared
        // since. Reporting success here would strand the preference.
        throw new Error('Web storage is unavailable');
      }
      // Do NOT swallow quota / private-mode refusals: the save path must
      // keep the last persisted value and the Settings switch must roll back.
      store.setItem(key, value);
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
let cachedSettings: ReferenceLibrarySettings | null = null;
let pendingLoad: Promise<ReferenceLibrarySettings> | null = null;

function getBackend(): KeyValue {
  if (backend === null) {
    const secure = isReactNativeRuntime() ? createSecureStoreStore() : null;
    backend =
      secure ?? (getWebLocalStorage() !== null ? createWebStore() : createMemoryStore());
  }
  return backend;
}

/** Normalize a stored value; anything unreadable falls back to the default. */
export function parseReferenceLibrarySettings(raw: string | null): ReferenceLibrarySettings {
  if (raw === null) return DEFAULT_REFERENCE_LIBRARY_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReferenceLibrarySettings>;
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_REFERENCE_LIBRARY_SETTINGS;
    }
    return {
      enabled:
        typeof parsed.enabled === 'boolean'
          ? parsed.enabled
          : DEFAULT_REFERENCE_LIBRARY_SETTINGS.enabled,
    };
  } catch {
    return DEFAULT_REFERENCE_LIBRARY_SETTINGS;
  }
}

type Listener = (settings: ReferenceLibrarySettings) => void;

/** Live subscribers — the Now entry, the Settings switch and the Clarify
 *  wizard all follow the same preference without a reload. */
const listeners = new Set<Listener>();

export function subscribeToReferenceLibrarySettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadReferenceLibrarySettings(): Promise<ReferenceLibrarySettings> {
  if (cachedSettings !== null) return cachedSettings;
  if (pendingLoad !== null) return pendingLoad;
  pendingLoad = getBackend()
    .getItem(REFERENCE_LIBRARY_SETTINGS_KEY)
    .then((raw) => {
      const parsed = parseReferenceLibrarySettings(raw);
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

export async function saveReferenceLibrarySettings(
  patch: Partial<ReferenceLibrarySettings>,
): Promise<ReferenceLibrarySettings> {
  const current = cachedSettings ?? (await loadReferenceLibrarySettings());
  const next: ReferenceLibrarySettings = {
    enabled: patch.enabled ?? current.enabled,
  };
  // Write FIRST, then adopt: a failed write must not leave the cache claiming
  // a preference the device never stored — the switch would read OFF while
  // the entry stayed visible.
  await getBackend().setItem(REFERENCE_LIBRARY_SETTINGS_KEY, JSON.stringify(next));
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
export function __setReferenceLibrarySettingsStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
  listeners.clear();
}
