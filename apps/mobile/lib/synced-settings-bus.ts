/**
 * Writer bridge between the device-local settings modules and the synced
 * `settings` table (issue #97).
 *
 * The settings modules (theme / focus / engine) stay synchronous and usable
 * without React. After a successful LOCAL write they report the same value
 * here; the `SyncedSettings` bridge (mounted inside the PowerSync provider)
 * registers a writer that persists it to the local PowerSync database. That
 * row uploads when connected and syncs to the other devices.
 *
 * A failed row write must not lose the user's choice. The newest value per
 * key is kept PENDING and persisted in device storage, so a reload or app
 * restart still knows it has not committed:
 *  - the bridge skips downloaded rows for a pending key (the local choice
 *    wins until the row is written);
 *  - a global banner offers a retry;
 *  - only a successful settings-table write clears the pending record.
 *
 * No registered writer (unit tests, the first frames before the provider
 * mounts) is a no-op. Writes are queued so rapid changes — e.g. repeated
 * time-chip taps — reach the table in the same order the user made them.
 */
import { isReactNativeRuntime } from '@nextdo/db';

export type SyncedSettingKey = 'theme-preference' | 'focus' | 'engine-context';

export type SyncedSettingWriter = (key: SyncedSettingKey, value: string) => Promise<void>;

/** One device-storage item per key: two open tabs share the store but only
 *  touch their own keys, so committing one setting cannot drop another tab's
 *  pending intent. */
export const PENDING_SETTINGS_STORAGE_PREFIX = 'nextdo.settings.pending.';

const SYNCED_SETTING_KEYS: readonly SyncedSettingKey[] = [
  'theme-preference',
  'focus',
  'engine-context',
];

function pendingStorageKey(key: SyncedSettingKey): string {
  return `${PENDING_SETTINGS_STORAGE_PREFIX}${key}`;
}

interface PendingWrite {
  value: string;
  /** Non-null while the value is not committed: an actual failure, or a
   *  restored pending write from a previous session. */
  error: Error | null;
}

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let writer: SyncedSettingWriter | null = null;
let queue: Promise<void> = Promise.resolve();
const pending = new Map<SyncedSettingKey, PendingWrite>();
const failureListeners = new Set<() => void>();

let pendingStore: KeyValue | null = null;
const memoryPending = new Map<string, string>();
let persistQueue: Promise<void> = Promise.resolve();

function getWebLocalStorage(): WebStorageLike | null {
  const g = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return g.window?.localStorage ?? g.localStorage ?? null;
}

function createPendingStore(): KeyValue {
  if (typeof isReactNativeRuntime === 'function' && isReactNativeRuntime()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('expo-secure-store') as {
        getItemAsync(key: string): Promise<string | null>;
        setItemAsync(key: string, value: string): Promise<void>;
        deleteItemAsync(key: string): Promise<void>;
      };
      return {
        getItem: (key) => store.getItemAsync(key),
        setItem: (key, value) => store.setItemAsync(key, value),
        removeItem: (key) => store.deleteItemAsync(key),
      };
    } catch {
      // Fall through to the in-memory fallback.
    }
  }
  const local = getWebLocalStorage();
  if (local !== null) {
    return {
      async getItem(key) {
        try {
          return local.getItem(key);
        } catch {
          return null;
        }
      },
      async setItem(key, value) {
        local.setItem(key, value);
      },
      async removeItem(key) {
        local.removeItem(key);
      },
    };
  }
  return {
    async getItem(key) {
      return memoryPending.get(key) ?? null;
    },
    async setItem(key, value) {
      memoryPending.set(key, value);
    },
    async removeItem(key) {
      memoryPending.delete(key);
    },
  };
}

function getPendingStore(): KeyValue {
  if (pendingStore === null) pendingStore = createPendingStore();
  return pendingStore;
}

export function registerSyncedSettingWriter(next: SyncedSettingWriter | null): void {
  writer = next;
}

/**
 * True while the newest local value for `key` has not been committed to the
 * settings table. The bridge uses this to ignore downloaded rows that are
 * older than the pending user intent.
 */
export function hasPendingSyncedSetting(key: string): boolean {
  return pending.has(key as SyncedSettingKey);
}

/** Number of keys whose value is not committed yet (drives the retry banner). */
export function getSyncedSettingFailureCount(): number {
  let count = 0;
  for (const state of pending.values()) {
    if (state.error !== null) count += 1;
  }
  return count;
}

export function subscribeToSyncedSettingFailures(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

function notifyFailureListeners(): void {
  for (const listener of Array.from(failureListeners)) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must not break the write path.
    }
  }
}

/**
 * Persist one key's current pending value (or remove its item when the value
 * has committed). Serialized so an older value cannot land after a newer one.
 * The read happens inside the queue so a superseding save is included.
 */
function persistKey(key: SyncedSettingKey): Promise<void> {
  const storageKey = pendingStorageKey(key);
  const run = persistQueue.then(() => {
    const state = pending.get(key);
    const store = getPendingStore();
    return state === undefined
      ? store.removeItem(storageKey)
      : store.setItem(storageKey, state.value);
  });
  persistQueue = run.catch(() => undefined);
  return run;
}

/**
 * Restore the pending writes saved by a previous app session. Called by the
 * bridge before it applies any downloaded row, so a reload cannot let an old
 * row overwrite a value whose write failed. Each key has its own storage
 * item, so another open tab committing a different setting cannot delete it.
 */
export async function restorePendingSyncedSettings(): Promise<void> {
  for (const key of SYNCED_SETTING_KEYS) {
    // A save made in this session before the restore finished is newer.
    if (pending.has(key)) continue;
    let raw: string | null;
    try {
      raw = await getPendingStore().getItem(pendingStorageKey(key));
    } catch {
      continue;
    }
    if (raw === null || raw === '') continue;
    pending.set(key, { value: raw, error: new Error('settings write not committed') });
  }
  notifyFailureListeners();
}

function enqueue(key: SyncedSettingKey, value: string, retrying: boolean): void {
  const current = writer;
  if (current === null) return;
  const previous = pending.get(key);
  // A fresh save replaces the previous intent and its error; a retry keeps
  // the error state visible until the attempt actually succeeds.
  pending.set(key, {
    value,
    error: retrying ? (previous?.error ?? null) : null,
  });
  if (!retrying) notifyFailureListeners();
  queue = queue.then(async () => {
    // Make the intent durable BEFORE attempting the row write: a crash or
    // reload between the two must still know the value is uncommitted.
    try {
      await persistKey(key);
    } catch {
      // Storage refusal: the DB attempt still proceeds; only restart
      // durability is lost.
    }
    try {
      await current(key, value);
      const state = pending.get(key);
      // A newer value may have replaced this one while the write was in
      // flight; only the newest intent may clear the pending record.
      if (state !== undefined && state.value === value) pending.delete(key);
    } catch (caught: unknown) {
      const state = pending.get(key);
      if (state !== undefined && state.value === value) {
        pending.set(key, {
          value,
          error: caught instanceof Error ? caught : new Error(String(caught)),
        });
      }
    }
    try {
      await persistKey(key);
    } catch {
      // Keep the row result; the retry banner still reflects the failure.
    }
    notifyFailureListeners();
  });
}

/** Record the user's newest value and queue it for the settings table. */
export function writeSyncedSetting(key: SyncedSettingKey, value: string): void {
  enqueue(key, value, false);
}

/** Re-attempt every uncommitted write, newest value per key. */
export function retrySyncedSettingWrites(): void {
  for (const [key, state] of Array.from(pending.entries())) {
    if (state.error !== null) enqueue(key, state.value, true);
  }
}

/** Test hook: await the queued writes (never rejects). */
export function __flushSyncedSettingWritesForTests(): Promise<void> {
  return queue;
}

/** Test hook: inject the pending-write store (null = platform default). */
export function __setSyncedSettingsPendingStoreForTests(store: KeyValue | null): void {
  pendingStore = store;
  memoryPending.clear();
  persistQueue = Promise.resolve();
}

/**
 * Test hook: clear in-memory state. Keep the pending store to simulate a
 * process restart within one test (`keepStore: true`).
 */
export function __resetSyncedSettingsBusForTests(options?: { keepStore?: boolean }): void {
  writer = null;
  queue = Promise.resolve();
  pending.clear();
  failureListeners.clear();
  if (options?.keepStore !== true) {
    pendingStore = null;
    memoryPending.clear();
    persistQueue = Promise.resolve();
  }
}
