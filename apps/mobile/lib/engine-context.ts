/**
 * Engine-context persistence (design.md §4.1): the Now screen's
 * `{ availableMinutes }` survives restarts.
 *
 * (The 场景 / contextIds half was removed with issue #46 — the engine input
 * is now a constant empty list, see `hooks/use-now.ts`.)
 *
 * Stored device-locally as the first-paint cache AND in the synced `settings`
 * table (issue #97): the synced-settings bridge applies downloaded rows back
 * here and mirrors user saves. The local store follows the owner-token
 * platform matrix:
 *   native (iOS/Android) → `expo-secure-store`
 *   browser web / Tauri → `localStorage` (persisted across sessions)
 *   Node / fallback → in-memory (re-selected after a restart)
 * Importing this file is safe on plain Node/jest (lazy backend selection,
 * the `expo-secure-store` require only runs on a native runtime).
 */
import { isReactNativeRuntime } from '@nextdo/db';
import { useCallback, useEffect, useRef, useState } from 'react';
import { writeSyncedSetting } from './synced-settings-bus';

export const ENGINE_CONTEXT_KEY = 'nextdo.settings.engine-context';

/**
 * The Now screen's engine inputs that survive a restart.
 *
 * `contextIds` used to live here too; the 场景 (contexts) feature was taken
 * offline in issue #46, so the engine now always receives an empty context
 * list (= anywhere / no filtering). The stored blob may still carry the old
 * key — `parseEngineContext` ignores unknown fields, so no migration runs.
 */
export interface EngineContextSettings {
  /** The time slot the user can give right now (minutes). */
  availableMinutes: number;
}

/** Scaffold defaults — the same values the vertical slice hardcoded. */
export const DEFAULT_ENGINE_CONTEXT: EngineContextSettings = { availableMinutes: 60 };

export const MAX_AVAILABLE_MINUTES = 1440;

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

function hasWebLocalStorage(): boolean {
  return getWebLocalStorage() !== null;
}

function createLocalStorageStore(): KeyValue {
  return {
    async getItem(key) {
      try {
        const storage = getWebLocalStorage();
        if (storage) {
          return storage.getItem(key);
        }
      } catch {
        // Fall back gracefully on storage access denied
      }
      return null;
    },
    async setItem(key, value) {
      const storage = getWebLocalStorage();
      if (!storage) {
        throw new Error('localStorage is unavailable');
      }
      // Quota / security errors must reach the caller: the settings hook
      // surfaces them, and a silent success would make the UI claim a
      // persisted selection the next load cannot read back.
      storage.setItem(key, value);
    },
  };
}

/** Keychain / Keystore — required lazily so plain Node never loads Expo. */
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
let cachedSettings: EngineContextSettings | null = null;
let pendingLoad: Promise<EngineContextSettings> | null = null;
/** Serializes `saveEngineContext` backend writes (last tap lands last). */
let writeQueue: Promise<void> = Promise.resolve();

function getBackend(): KeyValue {
  if (backend === null) {
    if (isReactNativeRuntime()) {
      backend = createSecureStoreStore();
    } else if (hasWebLocalStorage()) {
      // Presence, not a write probe: a full storage is still READABLE, and a
      // failed probe must not demote the session to an in-memory store that
      // silently loses the stored value (and every write).
      backend = createLocalStorageStore();
    } else {
      backend = createMemoryStore();
    }
  }
  return backend;
}

/** Test hook: point the module at a specific backend (null = reset). */
export function __setEngineContextStoreForTests(store: KeyValue | null): void {
  backend = store;
  cachedSettings = null;
  pendingLoad = null;
  writeQueue = Promise.resolve();
}

/**
 * Parse a stored blob; ANY corruption or missing field falls back to the
 * defaults (the setting must never take the Now screen down). Unknown keys
 * (e.g. the retired `contextIds`) are ignored on purpose.
 */
export function parseEngineContext(raw: string | null): EngineContextSettings {
  return (
    parseExplicitEngineContext(raw) ?? {
      availableMinutes: DEFAULT_ENGINE_CONTEXT.availableMinutes,
    }
  );
}

/** Parse a stored blob, or null when there is no stored value / it is junk.
 *  The default is NOT substituted: `readStoredEngineContext` must tell an
 *  explicit choice apart from a first-paint default. */
function parseExplicitEngineContext(raw: string | null): EngineContextSettings | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { availableMinutes?: unknown };
    const availableMinutes = obj.availableMinutes;
    if (
      typeof availableMinutes !== 'number' ||
      !Number.isFinite(availableMinutes) ||
      availableMinutes < 1
    ) {
      return null;
    }
    return { availableMinutes: Math.min(Math.round(availableMinutes), MAX_AVAILABLE_MINUTES) };
  } catch {
    return null;
  }
}

export async function loadEngineContext(): Promise<EngineContextSettings> {
  if (cachedSettings !== null) {
    return cachedSettings;
  }
  if (pendingLoad !== null) {
    return pendingLoad;
  }
  pendingLoad = getBackend()
    .getItem(ENGINE_CONTEXT_KEY)
    .then((raw) => {
      const parsed = parseEngineContext(raw);
      // A save that landed while this read was in flight owns the value: the
      // write queue may not have reached the backend yet, so the stale read
      // must not clobber the newer selection (storage and UI would disagree).
      const resolved = cachedSettings ?? parsed;
      cachedSettings = resolved;
      pendingLoad = null;
      return resolved;
    })
    .catch((err: unknown) => {
      pendingLoad = null;
      throw err;
    });
  return pendingLoad;
}

export async function saveEngineContext(settings: EngineContextSettings): Promise<void> {
  cachedSettings = settings;
  const raw = JSON.stringify({ availableMinutes: settings.availableMinutes });
  // Serialize backend writes: rapid chip taps fire overlapping saves, and
  // without the chain the slower earlier write could land last. The caller
  // still sees its own success/failure — the chain only orders the writes.
  const write = writeQueue.then(() => getBackend().setItem(ENGINE_CONTEXT_KEY, raw));
  writeQueue = write.catch(() => undefined);
  await write;
  writeSyncedSetting('engine-context', raw);
}

type Listener = (settings: EngineContextSettings) => void;

const listeners = new Set<Listener>();

/** Follow preference changes (the Now screen's open session keeps its chip in
 *  step with a value synced from another device). */
export function subscribeToEngineContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyEngineContext(next: EngineContextSettings): void {
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A misbehaving subscriber must not break the apply path.
    }
  }
}

/**
 * Apply a value downloaded from the synced `settings` table (issue #97). The
 * downloaded value wins over the device cache; the cache is refreshed for the
 * next cold start. A failed local cache write does not undo the applied value.
 */
export function applyEngineContextFromSync(next: EngineContextSettings): void {
  const raw = next.availableMinutes;
  const minutes =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(Math.max(Math.round(raw), 1), MAX_AVAILABLE_MINUTES)
      : DEFAULT_ENGINE_CONTEXT.availableMinutes;
  if (cachedSettings !== null && cachedSettings.availableMinutes === minutes) return;
  const normalized: EngineContextSettings = { availableMinutes: minutes };
  cachedSettings = normalized;
  try {
    void getBackend()
      .setItem(ENGINE_CONTEXT_KEY, JSON.stringify(normalized))
      .catch(() => undefined);
  } catch {
    // A storage refusal must not break the sync apply.
  }
  notifyEngineContext(normalized);
}

/**
 * The device's explicitly stored value, or null when nothing was stored (or
 * the store failed). Used by the synced-settings bridge to seed the table on
 * first login — a default is never seeded.
 *
 * The module cache is NOT used here: `loadEngineContext()` fills it with the
 * 60-minute default when the store is empty, and treating that as a choice
 * would overwrite another device's preference on a fresh device.
 */
export async function readStoredEngineContext(): Promise<EngineContextSettings | null> {
  try {
    return parseExplicitEngineContext(await getBackend().getItem(ENGINE_CONTEXT_KEY));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// React hook (design.md §5: read once, cache in memory, write-through)
// ---------------------------------------------------------------------------

export interface UseEngineContextSettingsResult {
  /** null until the first load settles (web/browser: nearly immediate). */
  settings: EngineContextSettings | null;
  error: string | null;
  /** Merge a partial patch, persist it (write-through), and update state. */
  update: (patch: Partial<EngineContextSettings>) => Promise<void>;
}

export function useEngineContextSettings(): UseEngineContextSettingsResult {
  const [settings, setSettings] = useState<EngineContextSettings | null>(cachedSettings);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<EngineContextSettings | null>(cachedSettings);
  settingsRef.current = settings;
  /**
   * A selection made before the mount read settles owns the UI. The read is
   * stale for BOTH outcomes: a late failure must not reset the value to the
   * defaults, and a late success must not clear the write error the user is
   * looking at.
   */
  const updatedSinceMountRef = useRef(false);

  // One load per mount — the value is cached in state thereafter.
  useEffect(() => {
    let cancelled = false;
    loadEngineContext()
      .then((loaded) => {
        if (cancelled || updatedSinceMountRef.current) return;
        settingsRef.current = loaded;
        setSettings(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || updatedSinceMountRef.current) return;
        // A broken store must not take the Now screen down — fall back to
        // the scaffold defaults (writes will keep failing and re-surface).
        setSettings(DEFAULT_ENGINE_CONTEXT);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A value synced from another device while this screen stays open (issue
  // #97): the bridge applies it to the module cache and notifies here.
  useEffect(
    () =>
      subscribeToEngineContext((next) => {
        settingsRef.current = next;
        setSettings(next);
      }),
    [],
  );

  const update = useCallback(async (patch: Partial<EngineContextSettings>) => {
    updatedSinceMountRef.current = true;
    const current = settingsRef.current ?? DEFAULT_ENGINE_CONTEXT;
    // Clamp the way `parseEngineContext` does, so the live state and the
    // persisted blob agree (the store would otherwise hold 9999 while the
    // next load reads back 1440).
    const minutes = patch.availableMinutes ?? current.availableMinutes;
    const next: EngineContextSettings = {
      availableMinutes:
        typeof minutes === 'number' && Number.isFinite(minutes)
          ? Math.min(Math.max(Math.round(minutes), 1), MAX_AVAILABLE_MINUTES)
          : DEFAULT_ENGINE_CONTEXT.availableMinutes,
    };
    settingsRef.current = next;
    setSettings(next);
    try {
      await saveEngineContext(next);
      setError(null);
    } catch (err: unknown) {
      // State stays updated locally; the error is surfaced, the next write
      // retries the persistence.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return { settings, error, update };
}
